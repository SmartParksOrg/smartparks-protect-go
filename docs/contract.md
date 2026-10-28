# The contract with Protect

Protect Go and Protect exchange two things, and the second is the one Protect already accepts.

## Down: the field bundle

When Protect Go is online, a user who is a member of a project asks Protect for the project's field bundle: `GET /projects/{id}/field-bundle` (Protect's phase 43 P2, built 2026-10-17; the page [Protect Go, the companion](https://smartparksorg.github.io/smartparks-protect/devices/field-companion/) in Protect's documentation). One JSON document, `format_version` 1, with:

- `project`: id, name, slug, time zone; `generated_at`, `protect_version`, `protect_commit` and `server_url`, where the upload goes;
- `devices`: the project's devices the caller may see, each with `device_type_key`, `driver_key`, `serial_number`, `dev_eui`, `status`, `firmware_version`, the entity it tracks now (`entity_id`, `entity_name`), `is_station`, and `lp0`: the tracker's `dev_addr`, `keys_set`, and `app_s_key` and `nwk_s_key` as 32 hex digits when `credentials_included` is true, null otherwise;
- `credentials_included`: whether the caller may set keys in Protect (device control in the project, or a server admin); a viewer gets every address and no key, and Protect Go shows that tracker's frames undecoded;
- `entities`: the entities those devices track, with type key and label, icon and a GeoJSON place when set by hand;
- `stations`: the offload stations with `station_eui` and a GeoJSON point where they stand, so a card is routed by the EUI in its file names;
- `metrics`: Protect's metric registry (key, label, unit, value type, category, description; Protect's decision D334), so the Data explorer names and units the values as Protect does; a bundle from an older server has none and the keys show instead;
- `areas`: the project's regions (Protect's decision D365), each a box (`west`, `south`, `east`, `north`) from its features, entity and device places and the current positions of its devices and entities, grouped where they lie within the server's region gap (100 km) of one another; `area` is their envelope, or null when the project has none yet; `map`: the state of the offline map cut for them (below), once one was asked for, with `regions` and `covers_areas`, whether the map's regions still cover the project's.

Protect writes every download to its audit log with how many devices, stations and keys it carried. Protect Go keeps the bundle encrypted on disk with a key from the laptop's keychain, or a key file where there is none (decision D11), and says when it is older than a week.

## Down: the offline map

`GET /projects/{id}/field-bundle/map` (Protect's phase 43 P3, built 2026-10-17) streams a PMTiles file: the project's regions, each with a five kilometre margin, down to zoom 14, cut in one file by Protect's export worker from the newest Protomaps planet build (OpenStreetMap data, ODbL), so a station in one country and a tracker in another travel together without the land between them. Headers `X-Map-Build` (the build's date) and `X-Content-SHA256`. While the map is being cut the answer is 202 with its state; 404 means none was asked for yet and `POST` on the same path asks for one, which takes the exports permission (an analyst or an admin; a viewer downloads but does not ask; a map under a month whose regions cover every region of the project is kept; `force` cuts again); 409 carries the reason the last attempt failed. When the bundle's `map.covers_areas` is false, Protect Go's load asks with `POST` before the `GET` (decision D35). Protect Go's `POST /api/map/fetch` does all of that for the chosen project, keeps the file as `maps/<project id>.pmtiles` in the data folder with `maps/<project id>.json` beside it (one map per project, decision D32), serves the loaded project's to MapLibre at `/api/map/tiles.pmtiles` with range requests, and fetches a map the server was still cutting by itself at a later connection check; the same check keeps every project with an offload station on the laptop (decision D34), so it reads `GET /projects` and each project's `GET /projects/{id}/offload` for the station count, and each project's `field-bundle/revision`. The sprites and glyphs of the Protomaps style ship inside Protect Go (`frontend/public/map/`), so the map draws with nothing from the internet.

## Up: the card files

Protect Go uploads the card's files exactly as it read them to `POST /devices/{station id}/offload-files` on the server the bundle came from, the upload the station's device page makes, one file a request (the station's device id comes from the bundle's `stations`; the call takes device control in the project). The server answers 201 with the file's row, or 201 with no file and the member under `skipped` flagged `duplicate` when it holds the same bytes already (Protect's decision D353; servers before it answered 422 naming the file "uploaded before", which the app still reads), and Protect Go keeps that answer on the file. The app leaves out a file it read before on the laptop (decision D30), so a card read twice is uploaded once. Protect decodes them with the same code, attributes the records to the entities as of their record time, and leaves out a file it already holds by its content digest and a frame it already holds by its hash. Protect Go keeps a queue of what is uploaded and what is not, and shows it.

## What never travels

- Nothing decoded leaves Protect Go. A position or a measurement Protect Go shows is Protect Go's reading of the card, and Protect makes its own.
- No master key. Protect Go holds session keys for the trackers in the bundle, never the LP0 master key, as Protect does not (Protect's decision D327).
- No notes, events or edits from Protect Go, for now. Should the offline user need to record things that must travel back, that becomes a small append-only outbox, a later phase, never a general merge.

## The parser and the decode path

Protect Go reads a card with `shared.station_files` from Protect's `shared` package (Protect's phase 43 P1): `unpack_card_zip`, `parse_station_jsonl`, `station_eui_from_name`. Each frame then goes through `shared.station_decode` (Protect's P6), the same two calls the server's pipeline makes: `unwrap_station_frame` opens it with the tracker's keys from the bundle and refuses it with the server's own codes and words (no keys, a station naming another tracker than the address belongs to, an LP0 metadata version this code does not read, a frame that does not verify), and `decode_station_frame` has the OpenCollar driver read the records. Protect tests that one frame decoded both ways gives the same positions, so a card read here and on the server cannot differ. None of these import a database.

## Versions

Protect Go pins Protect's `shared` package to a commit. The first screen names both the Protect Go version and that commit, so a difference between what Protect Go showed and what Protect decoded can be traced to a version. `scripts/dev.sh bump-protect` moves the pin and reruns the decoding proof.

## Signed in from the Offload page

Protect's Offload page asks `POST /api/v1/auth/go-handoff` (the signed-in person) for a one-time code and opens `protect-go://connect?server=<origin>&code=<code>` (Protect's decision D333, this side's D15). The app posts the code to `POST /api/v1/auth/go-handoff/exchange` `{code}` and receives `{access_token}` with 30 days of life, then reads the account at `GET /api/v1/users/me`. A code is good once, for two minutes; the server answers 404 after that, and the app says to open it from the Offload page again or to sign in with email and password. The exchange is throttled like the login.
