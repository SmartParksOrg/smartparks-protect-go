"""Loading a project for the field (decisions D2, D11, D31 and D32): one call fetches the bundle
from the Protect server and keeps it encrypted under the project's own file, then fetches the
project's map the same way, so a person presses one button before leaving. The laptop holds a
bundle per project and one of them is loaded; the top bar's switcher lists them (D33) and
switches without a connection. Every page reads the loaded project's bundle, cards and map."""

import contextlib
from dataclasses import asdict
from typing import Any

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from protect_go.bundle import PROJECT_ID, BundleStore, BundleSummary
from protect_go.cards import CardStore
from protect_go.routers.map import MapFetch, MapRead, fetch_project_map, read_map
from protect_go.store import Store

router = APIRouter(prefix="/api")


class BundleRead(BaseModel):
    present: bool
    revision: str = Field(default="", description="The server's fingerprint of the content")
    project_id: str | None = None
    project_name: str | None = None
    generated_at: str | None = None
    fetched_at: str | None = None
    protect_version: str | None = None
    server_url: str | None = None
    devices: int = 0
    stations: int = 0
    entities: int = 0
    trackers_with_keys: int = 0
    credentials_included: bool = False
    stale: bool = False
    key_kept_in: str | None = Field(default=None, description="keychain or file")


class LaptopProject(BaseModel):
    """A project on the laptop (D31): its bundle, whether it is the loaded one, its map and
    its cards."""

    project_id: str
    project_name: str
    fetched_at: str
    stale: bool
    current: bool
    map_present: bool
    cards: int = 0


class LoadRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=64, pattern=PROJECT_ID.pattern)
    project_name: str | None = Field(default=None, max_length=200)


class SwitchRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=64, pattern=PROJECT_ID.pattern)


class LoadResult(BaseModel):
    bundle: BundleRead
    map: MapRead
    frames_read_again: int = Field(
        default=0,
        description="Frames of addresses unknown before that the fresh bundle knows (D338)",
    )
    cards_adopted: int = Field(
        default=0, description="Cards of no project yet that this project's stations wrote (D32)"
    )


def _bundle_store(request: Request) -> BundleStore:
    store: BundleStore = request.app.state.bundle_store
    return store


def _card_store(request: Request) -> CardStore | None:
    cards: CardStore | None = getattr(request.app.state, "card_store", None)
    return cards


def _read(summary: BundleSummary | None) -> BundleRead:
    if summary is None:
        return BundleRead(present=False)
    return BundleRead(present=True, **asdict(summary))


def _settled(app: FastAPI, bundle: dict[str, Any], *, restart_sync: bool = True) -> int:
    """After a bundle is kept or switched to: the cards of no project yet that belong to it
    (D32), and, for a person's own load or switch, the follow-the-server state starts over so
    the next probe syncs at once (the background sync itself leaves its state alone)."""
    if restart_sync:
        app.state.bundle_follow = None
    cards: CardStore | None = getattr(app.state, "card_store", None)
    return cards.adopt_cards(bundle) if cards is not None else 0


@router.get("/bundle", response_model=BundleRead)
async def read_bundle(request: Request) -> BundleRead:
    """The loaded project's bundle."""
    return _read(_bundle_store(request).summary())


@router.get("/bundle/projects", response_model=list[LaptopProject])
async def laptop_projects(request: Request) -> list[LaptopProject]:
    """Every project on the laptop (D31), by name, for the switcher and the Server page."""
    store = _bundle_store(request)
    current = store.current_project_id()
    cards = _card_store(request)
    counts = cards.cards_per_project() if cards is not None else {}
    return [
        LaptopProject(
            project_id=s.project_id,
            project_name=s.project_name,
            fetched_at=s.fetched_at,
            stale=s.stale,
            current=s.project_id == current,
            map_present=read_map(request.app, s.project_id).present,
            cards=counts.get(s.project_id, 0),
        )
        for s in store.summaries()
    ]


@router.post("/bundle/switch", response_model=LoadResult)
async def switch_project(body: SwitchRequest, request: Request) -> LoadResult:
    """Make a project on the laptop the loaded one (D31): no connection needed, nothing
    fetched; the map and the cards shown are that project's from then on."""
    store = _bundle_store(request)
    summary = store.switch(body.project_id)
    if summary is None:
        raise HTTPException(404, "This project is not on the laptop; load it while online")
    loaded = store.load(body.project_id)
    adopted = _settled(request.app, loaded[0]) if loaded else 0
    return LoadResult(
        bundle=_read(summary), map=read_map(request.app, body.project_id), cards_adopted=adopted
    )


@router.delete("/bundle", response_model=BundleRead)
async def clear_bundle(request: Request, project_id: str | None = None) -> BundleRead:
    """Remove a project's bundle from the laptop (the loaded one without `project_id`)."""
    store = _bundle_store(request)
    if project_id is not None and not PROJECT_ID.match(project_id):
        raise HTTPException(422, "Not a project id")
    store.clear(project_id)
    request.app.state.bundle_follow = None
    return _read(store.summary())


class MetricDefinition(BaseModel):
    key: str
    label: str
    unit: str | None = None
    value_type: str
    category: str
    description: str | None = None


@router.get("/bundle/metrics", response_model=list[MetricDefinition])
async def metric_definitions(request: Request) -> list[dict[str, Any]]:
    """Protect's metric registry as the bundle carried it (Protect's decision D334), so the
    Data explorer names and units the values as Protect does; empty without a bundle or with
    one from a server older than the registry's arrival."""
    loaded = _bundle_store(request).load()
    if loaded is None:
        return []
    bundle, _fetched = loaded
    rows: list[dict[str, Any]] = list(bundle.get("metrics") or [])
    return rows


class StationRead(BaseModel):
    device_id: str
    name: str
    station_eui: str
    lat: float | None = None
    lon: float | None = None


class DeviceRead(BaseModel):
    id: str
    name: str
    serial_number: str | None = None
    dev_eui: str | None = None
    device_type_label: str | None = None
    driver_key: str | None = None
    status: str | None = None
    firmware_version: str | None = None
    entity_id: str | None = None
    entity_name: str | None = None
    is_station: bool = False
    has_address: bool = False
    has_keys: bool = False


@router.get("/bundle/devices", response_model=list[DeviceRead])
async def devices(request: Request) -> list[dict[str, Any]]:
    """The project's devices as the bundle knows them, never a key: what the Trackers and the
    Offload stations pages list beside what the files brought."""
    loaded = _bundle_store(request).load()
    if loaded is None:
        return []
    bundle, _fetched = loaded
    out: list[dict[str, Any]] = []
    for d in bundle.get("devices", []):
        lp0 = d.get("lp0") or {}
        out.append(
            {
                "id": str(d["id"]),
                "name": str(d["name"]),
                "serial_number": d.get("serial_number"),
                "dev_eui": d.get("dev_eui"),
                "device_type_label": d.get("device_type_label"),
                "driver_key": d.get("driver_key"),
                "status": d.get("status"),
                "firmware_version": d.get("firmware_version"),
                "entity_id": str(d["entity_id"]) if d.get("entity_id") else None,
                "entity_name": d.get("entity_name"),
                "is_station": bool(d.get("is_station")),
                "has_address": bool(lp0.get("dev_addr")),
                "has_keys": bool(lp0.get("app_s_key") and lp0.get("nwk_s_key")),
            }
        )
    return out


@router.get("/bundle/stations", response_model=list[StationRead])
async def stations(request: Request) -> list[dict[str, Any]]:
    """The offload stations of the bundle with where they stand, for the explorer's map."""
    loaded = _bundle_store(request).load()
    if loaded is None:
        return []
    bundle, _fetched = loaded
    out: list[dict[str, Any]] = []
    for s in bundle.get("stations", []):
        geometry = s.get("geometry") or {}
        coordinates = geometry.get("coordinates") if geometry.get("type") == "Point" else None
        out.append(
            {
                "device_id": str(s["device_id"]),
                "name": str(s.get("entity_name") or s.get("device_name") or s["station_eui"]),
                "station_eui": str(s["station_eui"]),
                "lon": coordinates[0] if coordinates else None,
                "lat": coordinates[1] if coordinates else None,
            }
        )
    return out


@router.post("/bundle/fetch", response_model=LoadResult)
async def load_project(body: LoadRequest, request: Request) -> LoadResult:
    """Fetch the project's bundle and keep it as the loaded project, then its map; the
    server's own words when either does not come."""
    return await load_bundle(request.app, body)


async def load_bundle(app: FastAPI, body: LoadRequest, *, make_current: bool = True) -> LoadResult:
    """The load behind the route and behind the background sync (D34): the bundle fetched and
    kept (as the loaded project, or beside it), the cards of no project yet adopted, the frames
    of trackers unknown before read again, then the map."""
    store: Store = app.state.store
    settings = store.load()
    if settings.server_url is None or not settings.signed_in:
        raise HTTPException(409, "Sign in to the server first")
    transport: httpx.AsyncBaseTransport | None = getattr(app.state, "http_transport", None)
    try:
        async with httpx.AsyncClient(
            base_url=settings.server_url, timeout=httpx.Timeout(60.0), transport=transport
        ) as http:
            response = await http.get(
                f"/api/v1/projects/{body.project_id}/field-bundle",
                headers={"Authorization": f"Bearer {settings.token}"},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"No answer from the server: {exc.__class__.__name__}") from None
    if response.status_code in (401, 403):
        raise HTTPException(401, "The sign-in has expired or may not read this project")
    if response.status_code != 200:
        detail = ""
        with contextlib.suppress(ValueError):
            detail = str(response.json().get("detail") or "")
        raise HTTPException(502, f"The server answered {response.status_code}: {detail}")
    try:
        bundle = response.json()
    except ValueError:
        raise HTTPException(502, "The server's bundle is not JSON") from None
    if not isinstance(bundle, dict) or bundle.get("format_version") != 1:
        raise HTTPException(502, "The server's bundle has a shape this version does not read")
    if str(bundle.get("project", {}).get("id")) != body.project_id:
        raise HTTPException(502, "The server's bundle names another project than the one asked")
    bundle_store: BundleStore = app.state.bundle_store
    summary = bundle_store.save(bundle, make_current=make_current)
    adopted = _settled(app, bundle, restart_sync=make_current)
    # a tracker added in Protect since the cards were read: its frames decode now (D338)
    cards: CardStore | None = getattr(app.state, "card_store", None)
    read_again = cards.read_unknown_again(bundle) if cards is not None else 0
    name = body.project_name or summary.project_name
    # the server's map was cut for regions the project has outgrown (a tracker far from the
    # stations; Protect's decision D365, D35 here): ask for a new one before fetching
    served_map = bundle.get("map")
    outgrown = not isinstance(served_map, dict) or served_map.get("covers_areas", True) is False
    try:
        map_state = await fetch_project_map(
            app,
            MapFetch(project_id=body.project_id, project_name=name),
            ask_first=outgrown and isinstance(served_map, dict),
        )
    except HTTPException as exc:
        map_state = read_map(app, body.project_id)
        map_state.server_state = f"The map did not come: {exc.detail}"
    return LoadResult(
        bundle=_read(summary),
        map=map_state,
        frames_read_again=read_again,
        cards_adopted=adopted,
    )
