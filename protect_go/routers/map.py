"""The offline map (Protect Go's decision D4; Protect's phase 43 P3): the project's PMTiles file,
downloaded from the Protect server while online and served to MapLibre here with range requests,
so the map draws without a connection. One map per project (decision D32), in
`maps/<project id>.pmtiles` in the data folder with `maps/<project id>.json` beside it saying
which build it is; the loaded project's map is the one served."""

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from protect_go.bundle import PROJECT_ID
from protect_go.routers.common import current_project_id
from protect_go.store import Store

router = APIRouter(prefix="/api")

RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")
CHUNK = 1 << 20


class MapRead(BaseModel):
    present: bool
    project_id: str | None = None
    project_name: str | None = None
    build: str | None = None
    size_bytes: int | None = None
    sha256: str | None = None
    downloaded_at: str | None = None
    west: float | None = None
    south: float | None = None
    east: float | None = None
    north: float | None = None
    max_zoom: int | None = None
    #: What the server said when the map was asked for and was not ready: its state in words
    server_state: str | None = None


class MapFetch(BaseModel):
    project_id: str = Field(min_length=1, max_length=64, pattern=PROJECT_ID.pattern)
    project_name: str | None = Field(default=None, max_length=200)


def map_paths(data_dir: Path, project_id: str) -> tuple[Path, Path]:
    """The project's map file and the note beside it."""
    if not PROJECT_ID.match(project_id):
        raise ValueError(f"Not a project id: {project_id!r}")
    folder = data_dir / "maps"
    return folder / f"{project_id}.pmtiles", folder / f"{project_id}.json"


def migrate_legacy_map(data_dir: Path) -> None:
    """The one `map.pmtiles` of versions before D32 moves under the project it was cut for,
    which its `map.json` names; a file without that note is dropped."""
    legacy_file, legacy_meta = data_dir / "map.pmtiles", data_dir / "map.json"
    if not legacy_file.is_file():
        if legacy_meta.is_file():
            legacy_meta.unlink()
        return
    project_id = None
    if legacy_meta.is_file():
        try:
            project_id = str(json.loads(legacy_meta.read_text(encoding="utf-8"))["project_id"])
        except (ValueError, KeyError, TypeError):
            project_id = None
    if project_id is None or not PROJECT_ID.match(project_id):
        legacy_file.unlink()
        if legacy_meta.is_file():
            legacy_meta.unlink()
        return
    file, meta = map_paths(data_dir, project_id)
    file.parent.mkdir(parents=True, exist_ok=True)
    if file.exists():
        legacy_file.unlink()
        legacy_meta.unlink()
    else:
        legacy_file.replace(file)
        legacy_meta.replace(meta)


def _data_dir(app: FastAPI) -> Path:
    store: Store = app.state.store
    return store.path.parent


def _words(app: FastAPI) -> dict[str, str]:
    """The server's last words per project about a map that did not come, kept for the pages
    while the app runs."""
    words: dict[str, str] | None = getattr(app.state, "map_words", None)
    if words is None:
        words = {}
        app.state.map_words = words
    return words


def read_map(app: FastAPI, project_id: str | None) -> MapRead:
    if project_id is None or not PROJECT_ID.match(project_id):
        return MapRead(present=False)
    file, meta = map_paths(_data_dir(app), project_id)
    if not file.is_file() or not meta.is_file():
        return MapRead(
            present=False, project_id=project_id, server_state=_words(app).get(project_id)
        )
    info: dict[str, Any] = json.loads(meta.read_text(encoding="utf-8"))
    return MapRead(present=True, size_bytes=file.stat().st_size, **info)


@router.get("/map", response_model=MapRead)
async def map_state(request: Request, project_id: str | None = None) -> MapRead:
    """The map on the laptop for the loaded project, or for `project_id`."""
    return read_map(request.app, project_id or current_project_id(request))


@router.post("/map/fetch", response_model=MapRead)
async def fetch_map(body: MapFetch, request: Request) -> MapRead:
    """Ask the server for the project's map and keep it (`fetch_project_map`)."""
    return await fetch_project_map(request.app, body)


async def fetch_project_map(app: FastAPI, body: MapFetch, *, ask_first: bool = False) -> MapRead:
    """Ask the server for the project's map and keep it: the server's `GET
    /projects/{id}/field-bundle/map` streams the file when it is ready, answers 202 with its
    state while it is being cut (then this asks for it with POST and says so), 404 when none was
    asked for yet (the same POST), and 409 when the last attempt failed. With `ask_first` the
    POST comes before the GET: the bundle said the server's map no longer covers the project's
    regions (a tracker far from the stations, decision D35), so a new one is asked for and the
    GET then answers 202 until it is cut. Called by the route and by the background sync (D34),
    so it takes the app and not a request."""
    store: Store = app.state.store
    settings = store.load()
    if settings.server_url is None or not settings.signed_in:
        raise HTTPException(409, "Sign in to the server first")
    transport: httpx.AsyncBaseTransport | None = getattr(app.state, "http_transport", None)
    headers = {"Authorization": f"Bearer {settings.token}"}
    path = f"/api/v1/projects/{body.project_id}/field-bundle/map"
    file, meta = map_paths(_data_dir(app), body.project_id)
    words = _words(app)
    try:
        async with httpx.AsyncClient(
            base_url=settings.server_url,
            timeout=httpx.Timeout(60.0, read=600.0),
            transport=transport,
        ) as http:
            asked: httpx.Response | None = None
            if ask_first:
                asked = await http.post(path, json={}, headers=headers)
                if asked.status_code == 403:
                    words[body.project_id] = (
                        "The project has places the map on this laptop does not cover, and "
                        "your account may not ask the server for a new one; ask an analyst or "
                        "an administrator of the project to open the Offload page and prepare "
                        "the map"
                    )
                    return read_map(app, body.project_id)
                if asked.status_code not in (202, 200):
                    raise HTTPException(
                        502, f"The server answered {asked.status_code}: {await _detail(asked)}"
                    )
            async with http.stream("GET", path, headers=headers) as response:
                if response.status_code == 200:
                    file.parent.mkdir(parents=True, exist_ok=True)
                    tmp = file.with_suffix(".pmtiles.part")
                    with tmp.open("wb") as handle:
                        async for chunk in response.aiter_bytes(CHUNK):
                            handle.write(chunk)
                    tmp.replace(file)
                    meta.write_text(
                        json.dumps(
                            {
                                "project_id": body.project_id,
                                "project_name": body.project_name,
                                "build": response.headers.get("x-map-build") or None,
                                "sha256": response.headers.get("x-content-sha256") or None,
                                "downloaded_at": datetime.now(UTC).isoformat(),
                                **_bounds(file),
                            }
                        ),
                        encoding="utf-8",
                    )
                    words.pop(body.project_id, None)
                    return read_map(app, body.project_id)
                detail = await _detail(response)
            if response.status_code in (404, 202):
                if asked is None:
                    asked = await http.post(path, json={}, headers=headers)
                if asked.status_code == 403:
                    words[body.project_id] = (
                        "The server has no map of this project yet, and your account may not "
                        "ask for one; ask an analyst or an administrator of the project to open "
                        "the Offload page and prepare the map"
                    )
                    return read_map(app, body.project_id)
                if asked.status_code == 202:
                    state = asked.json()
                    words[body.project_id] = (
                        f"The server is making the map ({state.get('status')}); the app fetches "
                        "it by itself within a few minutes while online"
                    )
                    return read_map(app, body.project_id)
                raise HTTPException(
                    502, f"The server answered {asked.status_code}: {await _detail(asked)}"
                )
            if response.status_code in (401, 403):
                raise HTTPException(401, "The sign-in has expired or may not read this project")
            raise HTTPException(502, f"The server answered {response.status_code}: {detail}")
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"No answer from the server: {exc.__class__.__name__}") from None


async def _detail(response: httpx.Response) -> str:
    try:
        body = await response.aread()
        detail = json.loads(body).get("detail")
        return str(detail) if detail else body.decode(errors="replace")[:200]
    except (ValueError, AttributeError):
        return ""


def _bounds(file: Path) -> dict[str, Any]:
    """The box and zoom from the PMTiles header, for the page to open the map on."""
    from pmtiles.reader import MmapSource, Reader

    with file.open("rb") as handle:
        header = Reader(MmapSource(handle)).header()
    return {
        "west": header["min_lon_e7"] / 1e7,
        "south": header["min_lat_e7"] / 1e7,
        "east": header["max_lon_e7"] / 1e7,
        "north": header["max_lat_e7"] / 1e7,
        "max_zoom": header["max_zoom"],
    }


@router.get("/map/tiles.pmtiles", include_in_schema=False)
async def serve_map(request: Request) -> Response:
    """The loaded project's PMTiles file (the address of versions before v0.17.1)."""
    project_id = current_project_id(request)
    if project_id is None:
        raise HTTPException(404, "No project is loaded")
    return _serve(request, project_id)


@router.get("/map/{project_id}/tiles.pmtiles", include_in_schema=False)
async def serve_project_map(project_id: str, request: Request) -> Response:
    """One project's PMTiles file at an address of its own (Tim, 2026-10-24: a switch between
    projects kept the old tiles, since MapLibre's pmtiles reader caches the archive, its header
    and directories, by address; one address per project gives it a fresh archive)."""
    if not PROJECT_ID.match(project_id):
        raise HTTPException(404, "Not a project id")
    return _serve(request, project_id)


def _serve(request: Request, project_id: str) -> Response:
    """A project's PMTiles file for the pmtiles protocol of MapLibre, which reads it with
    range requests: the header first, then the directories, then the tiles in view."""
    file, _meta = map_paths(_data_dir(request.app), project_id)
    if not file.is_file():
        raise HTTPException(404, "No map of this project on this laptop yet")
    size = file.stat().st_size
    header = request.headers.get("range")
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "no-cache"}
    if header is None:
        return StreamingResponse(
            _chunks(file, 0, size - 1),
            media_type="application/vnd.pmtiles",
            headers={**headers, "Content-Length": str(size)},
        )
    match = RANGE.match(header.strip())
    if match is None:
        raise HTTPException(416, "Range not understood")
    start_text, end_text = match.groups()
    if start_text == "" and end_text == "":
        raise HTTPException(416, "Range not understood")
    if start_text == "":
        start, end = max(0, size - int(end_text)), size - 1
    else:
        start = int(start_text)
        end = min(int(end_text), size - 1) if end_text else size - 1
    if start >= size or start > end:
        raise HTTPException(
            416, "Range beyond the file", headers={"Content-Range": f"bytes */{size}"}
        )
    return StreamingResponse(
        _chunks(file, start, end),
        status_code=206,
        media_type="application/vnd.pmtiles",
        headers={
            **headers,
            "Content-Range": f"bytes {start}-{end}/{size}",
            "Content-Length": str(end - start + 1),
        },
    )


async def _chunks(file: Path, start: int, end: int):  # type: ignore[no-untyped-def]  # noqa: ANN202
    with file.open("rb") as handle:
        handle.seek(start)
        left = end - start + 1
        while left > 0:
            data = handle.read(min(CHUNK, left))
            if not data:
                break
            left -= len(data)
            yield data
