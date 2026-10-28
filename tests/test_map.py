"""The offline map on the laptop (decision D4): fetched from the server once ready, asked for
when the server has none yet, and served to MapLibre with range requests."""

import json
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

from protect_go.bundle import BundleStore
from protect_go.config import get_settings
from protect_go.main import create_app
from protect_go.routers.map import migrate_legacy_map
from tests.test_bundle import BUNDLE
from tests.test_setup import LONG_TOKEN, TOKEN, protect_server

PROJECT = "11111111-1111-1111-1111-111111111111"


def small_map(path: Path) -> bytes:
    tiles = sorted(
        (zxy_to_tileid(z, x, y), f"{z}/{x}/{y}".encode())
        for z in range(3)
        for x in range(2**z)
        for y in range(2**z)
    )
    with path.open("wb") as handle:
        writer = Writer(handle)
        for tileid, data in tiles:
            writer.write_tile(tileid, data)
        writer.finalize(
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.NONE,
                "min_zoom": 0,
                "max_zoom": 2,
                "min_lon_e7": -110_000_000,
                "min_lat_e7": 76_000_000,
                "max_lon_e7": -108_000_000,
                "max_lat_e7": 79_000_000,
                "clustered": True,
                "center_zoom": 0,
                "center_lon_e7": 0,
                "center_lat_e7": 0,
            },
            {"name": "gola"},
        )
    return path.read_bytes()


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("PROTECT_GO_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("PROTECT_GO_KEY_STORE", "file")
    get_settings.cache_clear()
    application = create_app()
    yield application
    get_settings.cache_clear()


async def _signed_in(client: AsyncClient, app) -> None:
    app.state.http_transport = httpx.MockTransport(protect_server)
    await client.put("/api/setup/server", json={"server_url": "https://dev-protect.example.org"})
    signed = await client.post(
        "/api/session", json={"email": "ranger@example.org", "password": "right"}
    )
    assert signed.status_code == 200, signed.text


async def test_the_map_is_asked_for_then_fetched_then_served_in_ranges(app, tmp_path):
    planet = small_map(tmp_path / "server-map.pmtiles")
    state = {"ready": False, "asked": 0}

    def server(request: httpx.Request) -> httpx.Response:
        if request.url.path == f"/api/v1/projects/{PROJECT}/field-bundle/map":
            assert request.headers["Authorization"] in (f"Bearer {TOKEN}", f"Bearer {LONG_TOKEN}")
            if request.method == "POST":
                if state.get("forbid"):
                    return httpx.Response(
                        403, json={"detail": "Permission exports:create required"}
                    )
                state["asked"] += 1
                return httpx.Response(202, json={"status": "queued"})
            if not state["ready"]:
                return httpx.Response(404, json={"detail": "No offline map yet"})
            return httpx.Response(
                200, content=planet, headers={"X-Map-Build": "20261015", "X-Content-SHA256": "abc"}
            )
        return protect_server(request)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/map")).json()["present"] is False
        refused = await client.post("/api/map/fetch", json={"project_id": PROJECT})
        assert refused.status_code == 409 and "Sign in" in refused.text
        await _signed_in(client, app)
        app.state.http_transport = httpx.MockTransport(server)

        # the server has no map yet: Protect Go asks for one and says so
        first = await client.post(
            "/api/map/fetch", json={"project_id": PROJECT, "project_name": "LP0"}
        )
        assert first.status_code == 200, first.text
        assert first.json()["present"] is False and "making the map" in first.json()["server_state"]
        assert state["asked"] == 1

        # a viewer's account may not ask the server to cut a map; Protect Go says whom to ask
        state["forbid"] = True
        told = await client.post("/api/map/fetch", json={"project_id": PROJECT})
        assert told.status_code == 200 and "ask an analyst" in told.json()["server_state"]
        state["forbid"] = False

        state["ready"] = True
        got = await client.post(
            "/api/map/fetch", json={"project_id": PROJECT, "project_name": "LP0"}
        )
        assert got.status_code == 200, got.text
        body = got.json()
        assert body["present"] and body["build"] == "20261015" and body["project_name"] == "LP0"
        assert body["size_bytes"] == len(planet) and body["max_zoom"] == 2
        assert round(body["west"], 1) == -11.0 and round(body["north"], 1) == 7.9
        note = tmp_path / "data" / "maps" / f"{PROJECT}.json"
        assert json.loads(note.read_text())["project_id"] == PROJECT
        # the tiles served are the loaded project's (D32): none is loaded yet
        assert (await client.get("/api/map/tiles.pmtiles")).status_code == 404
        assert (await client.get("/api/map")).json()["present"] is False
        BundleStore(tmp_path / "data", "file").save(
            {**BUNDLE, "project": {"id": PROJECT, "name": "LP0"}}
        )
        assert (await client.get("/api/map")).json()["present"] is True

        whole = await client.get("/api/map/tiles.pmtiles")
        assert whole.status_code == 200 and whole.content == planet
        assert whole.headers["accept-ranges"] == "bytes"
        head = await client.get("/api/map/tiles.pmtiles", headers={"Range": "bytes=0-126"})
        assert head.status_code == 206 and head.content == planet[:127]
        assert head.headers["content-range"] == f"bytes 0-126/{len(planet)}"
        tail = await client.get(
            "/api/map/tiles.pmtiles", headers={"Range": f"bytes={len(planet) - 10}-"}
        )
        assert tail.status_code == 206 and tail.content == planet[-10:]
        beyond = await client.get(
            "/api/map/tiles.pmtiles", headers={"Range": f"bytes={len(planet) + 5}-"}
        )
        assert beyond.status_code == 416


async def test_a_map_the_project_outgrew_is_asked_for_again_on_a_load(app, tmp_path):
    """Decision D35 (Tim, 2026-10-28: the tracker drove through Namibia and the map held the
    Netherlands, where the station stands). The bundle says whether the server's map still
    covers the project's regions; when it does not, the load asks the server for a new one
    before fetching, and says so while it is being cut."""
    planet = small_map(tmp_path / "server-map.pmtiles")
    state = {"asked": 0, "covers": False}

    def server(request: httpx.Request) -> httpx.Response:
        if request.url.path == f"/api/v1/projects/{PROJECT}/field-bundle":
            served_map = {
                "status": "ready",
                "west": -11.0,
                "south": 7.6,
                "east": -10.8,
                "north": 7.9,
                "regions": [{"west": -11.0, "south": 7.6, "east": -10.8, "north": 7.9}],
                "covers_areas": state["covers"],
                "max_zoom": 2,
                "build": "20261015",
                "requested_at": "2026-10-17T10:00:00Z",
                "ready_at": "2026-10-17T10:05:00Z",
            }
            return httpx.Response(
                200,
                json={
                    **BUNDLE,
                    "project": {"id": PROJECT, "name": "LP0"},
                    "map": served_map,
                    "revision": "r1",
                },
            )
        if request.url.path == f"/api/v1/projects/{PROJECT}/field-bundle/map":
            if request.method == "POST":
                state["asked"] += 1
                return httpx.Response(202, json={"status": "queued"})
            if state["asked"]:
                return httpx.Response(202, json={"status": "queued"})
            return httpx.Response(200, content=planet, headers={"X-Map-Build": "20261015"})
        return protect_server(request)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await _signed_in(client, app)
        app.state.http_transport = httpx.MockTransport(server)
        loaded = (
            await client.post(
                "/api/bundle/fetch", json={"project_id": PROJECT, "project_name": "LP0"}
            )
        ).json()
        # the map no longer covers the project: asked for, not fetched, and said so
        assert state["asked"] == 1
        assert loaded["map"]["present"] is False
        assert "making the map" in loaded["map"]["server_state"]
        # a map that covers the project is fetched without asking
        state.update(asked=0, covers=True)
        loaded = (
            await client.post(
                "/api/bundle/fetch", json={"project_id": PROJECT, "project_name": "LP0"}
            )
        ).json()
        assert state["asked"] == 0 and loaded["map"]["present"] is True


def test_the_one_map_of_before_moves_under_its_project(tmp_path):
    """Versions before D32 kept one `map.pmtiles`; it becomes the project's own file, named by
    the note beside it, and a file without a note is dropped."""
    data = tmp_path / "data"
    data.mkdir()
    (data / "map.pmtiles").write_bytes(b"tiles")
    (data / "map.json").write_text(json.dumps({"project_id": PROJECT, "build": "20261017"}))
    migrate_legacy_map(data)
    assert not (data / "map.pmtiles").exists() and not (data / "map.json").exists()
    assert (data / "maps" / f"{PROJECT}.pmtiles").read_bytes() == b"tiles"
    assert json.loads((data / "maps" / f"{PROJECT}.json").read_text())["build"] == "20261017"
    (data / "map.pmtiles").write_bytes(b"orphan")
    migrate_legacy_map(data)
    assert not (data / "map.pmtiles").exists()
    assert (data / "maps" / f"{PROJECT}.pmtiles").read_bytes() == b"tiles"


async def test_a_map_the_server_was_still_cutting_comes_with_the_next_probe(app, tmp_path):
    """D32: the load found the server cutting the map; the connection probe fetches it once it
    is ready, so the Overview draws the right tiles without a hand on Server."""
    planet = small_map(tmp_path / "server-map.pmtiles")
    state = {"ready": False}

    def server(request: httpx.Request) -> httpx.Response:
        if request.url.path == f"/api/v1/projects/{PROJECT}/field-bundle":
            return httpx.Response(
                200,
                json={**BUNDLE, "project": {"id": PROJECT, "name": "LP0"}, "revision": "r1"},
            )
        if request.url.path == f"/api/v1/projects/{PROJECT}/field-bundle/revision":
            return httpx.Response(200, json={"revision": "r1"})
        if request.url.path == f"/api/v1/projects/{PROJECT}/field-bundle/map":
            if request.method == "POST":
                return httpx.Response(202, json={"status": "running"})
            if not state["ready"]:
                return httpx.Response(202, json={"status": "running"})
            return httpx.Response(200, content=planet, headers={"X-Map-Build": "20261024"})
        return protect_server(request)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await _signed_in(client, app)
        app.state.http_transport = httpx.MockTransport(server)
        loaded = (
            await client.post(
                "/api/bundle/fetch", json={"project_id": PROJECT, "project_name": "LP0"}
            )
        ).json()
        assert loaded["map"]["present"] is False
        assert "fetches it by itself" in loaded["map"]["server_state"]
        # the pages read the server's words until the map comes
        assert "fetches it by itself" in (await client.get("/api/map")).json()["server_state"]
        await client.get("/api/setup/connection")
        await app.state.bundle_sync_task
        probe = (await client.get("/api/setup/connection")).json()
        assert probe["map_updated_at"] is None
        state["ready"] = True
        app.state.bundle_follow = {**app.state.bundle_follow, "due": None}
        await client.get("/api/setup/connection")
        await app.state.bundle_sync_task
        probe = (await client.get("/api/setup/connection")).json()
        assert probe["map_updated_at"] is not None
        after = (await client.get("/api/map")).json()
        assert after["present"] is True and after["build"] == "20261024"
        assert after["server_state"] is None


async def test_each_projects_tiles_have_an_address_of_their_own(app, tmp_path):
    """v0.17.1 (Tim, 2026-10-24: a switch between projects kept the old tiles): MapLibre's
    pmtiles reader caches an archive by address, so every project's file is served at its own."""
    planet = small_map(tmp_path / "server-map.pmtiles")
    data = tmp_path / "data"
    (data / "maps").mkdir(parents=True)
    (data / "maps" / f"{PROJECT}.pmtiles").write_bytes(planet)
    (data / "maps" / f"{PROJECT}.json").write_text(json.dumps({"project_id": PROJECT}))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        own = await client.get(f"/api/map/{PROJECT}/tiles.pmtiles", headers={"Range": "bytes=0-9"})
        assert own.status_code == 206 and own.content == planet[:10]
        assert (await client.get("/api/map/other-project-0001/tiles.pmtiles")).status_code == 404
        assert (await client.get("/api/map/not%20an%20id/tiles.pmtiles")).status_code == 404
