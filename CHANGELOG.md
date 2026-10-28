# Changelog

All notable changes to Smart Parks Protect Go. The format follows Keep a Changelog; versions are git tags. Each entry names the Protect commit the release decodes with.

## Unreleased

### Fixed

- **The map follows a tracker that went far from the stations** (Tim, 2026-10-28, decision D35: SP051307 drove through Namibia and the app's map held the Netherlands, where the offload station stands, and nothing of where the tracker was). Protect now cuts the map from several regions in one file, the project's places and the current positions of its devices grouped by distance (Protect's decision D365), and the bundle says whether the server's map still covers them. When it does not, a load of the project asks the server for a new map before fetching, says so while it is being cut, and the next sync brings it; a map that covers the project is fetched as before. A server before Protect's D365 answers no such word and the app behaves as it did.

## v0.17.3, 2026-10-24

### Fixed

- **The map follows a switch made from another page** (Tim, 2026-10-24: open the Overview on one project, go to Offload stations or any other page, choose another project at the top; the Overview opened without its map). The switch opens the Overview while the new project is still settling, so its map was created for the old project and the change came before the map had finished loading, where it was lost. A map now waits for its project before it is made, applies a project that changed while it was loading once it is ready, and the switch hands the new project's map state to the pages at once. Checked in a browser from the Offload stations, Trackers and Files pages, and on the Data explorer's map, a station's page and a card's page after a switch.

## v0.17.2, 2026-10-24

### Fixed

- **The map redraws after a switch between projects** (Tim, 2026-10-24, the second half of v0.17.1's fix). The tiles came from the right address, but the map library applied the new style as a difference against the old one and never reported it loaded, so the stations, the tracks and the tiles were not drawn again. The style is now reloaded whole on a switch and on a change of theme; checked in a browser with a switch between the two dev projects.

## v0.17.1, 2026-10-24

### Fixed

- **The map follows a switch between projects** (Tim, 2026-10-24: after a switch at the top the map did not load; a fresh start of the app drew it). Every map read its tiles from one address, and the map library's PMTiles reader caches an archive, its header and directories, by address, so after a switch it kept serving the previous project's archive. Each project's tiles now have an address of their own (`GET /api/map/{project id}/tiles.pmtiles`), and the Overview's map, the Data explorer's map and a card's map rebuild their style when the project changes.

## v0.17.0, 2026-10-24

### Added

- **Every project with an offload station is kept on this laptop, with its map, in the background** (Tim, 2026-10-24, decision D34: after v0.16.0 a switch to another project showed no map, since the app fetched one project's map at a time; switching should be a view change, with nothing left to fetch). While the app is online and signed in, a sync every five minutes lists the server's projects, loads the ones with an offload station that are not on the laptop yet, loads again the ones that changed on the server, and fetches a map that is missing, all beside the loaded project, which stays the loaded one. The switcher and the Server page say so, and the Server page's Project line counts the projects on the laptop. `GET /api/setup/connection` answers `projects_synced_at`, `projects_loaded` and `projects_on_laptop`.

## v0.16.0, 2026-10-24

### Added

- **The project at the top, and the laptop organised per project** (Tim, 2026-10-24, decisions D31 to D33: with the LP0 demo project on the laptop he loaded Smart Parks - LP0 from the Server page; the app did not say which project it used, the Overview drew the real station on the demo project's map tiles, and the Offload stations and Trackers pages listed both projects' devices). The top bar now carries the project switcher as Protect's does: the loaded project's name as a button, the projects on this laptop, which switch at once without a connection, and, online and signed in, the server's projects with an offload station, which are loaded with their devices, keys and map when chosen. The laptop keeps a bundle and a map per project, and every page is the loaded project's: its SD card files, trackers, stations, data explorer, uploads and map, nothing of another; a card read before this version finds its project the first time that project is loaded. A map the server was still cutting when the project was loaded comes by itself within a few minutes while online, and the Overview says so meanwhile and offers "Fetch the map now". The Server page's project section lists the projects on the laptop with Use, and the Files page says how many SD cards of other projects it leaves out. The one bundle and map of earlier versions are moved under their project at the first start. `GET /api/bundle/projects`, `POST /api/bundle/switch`, `GET /api/map?project_id=`, `cards_adopted` and `map_updated_at` in the answers. Protect pinned at d2d356a still.

### Changed

- **The audit's advisories of 2026-10-24**: Electron 44.9.3 in the shell (GHSA-jr5w-w6x2-84p9 on 44.0 to 44.9.0, with fast-uri 3.1.9 in its tree) setuptools 84.2.1 and brotlicffi 1.2.1.0 in the Python lock (GHSA-xmj3-9gf7-h52w and the brotli advisory; transitive dependencies the app never imports), and vitest's mocker 4.1.12 in the frontend's tree. No code of the app changed.

## v0.15.1, 2026-10-23

### Fixed

- **The empty strip along the right edge of the window is gone** (Tim, 2026-10-23, as in Protect the same day). The stylesheet copied from Protect reserved room for a page scrollbar on the root (`scrollbar-gutter: stable`) while only the main column scrolls, so the shell on Windows showed 15 px of empty background beside every page. The rule is gone. Protect pinned at d2d356a still.

## v0.15.0, 2026-10-23

### Added

- **A file read before is left out, and the page says so** (Tim, 2026-10-23, decision D30: the duplicate check must hold on the laptop too, not only on the server). Reading a card looks every file up by its content over everything read so far, and within the same drop: a file read before is not kept, not read again and never waits for the upload a second time; the Files page says "N files were read before and were left out" with each file's name, the SD card that holds it and when it was read, and a card whose every file was read before makes no card at all and says "Nothing new". A card read again after it grew adds its new files alone. On the upload, the app reads Protect's new `duplicate` flag on a skipped file (Protect's decision D353) beside the words "uploaded before" of older servers.

### Changed

- **Protect pinned at d2d356a** (Protect's `main` of 2026-10-23, decisions up to D353). The shared package is unchanged in what the app imports; the pin moves for the dependency audit: Pillow 13.0.0 and certifi 2026.10.23 (both flagged on 2026-10-23), brotli 1.2.1 and the OpenTelemetry family 1.45.1, so the app ships the same versions as the server.
- **Protect pinned at b8c1c1c** (Protect's `main` of 2026-10-20, decisions up to D345). The pinned driver reads an offload station's port 23 report in its versions 2 and 3 (the firmware branch of 2026-10-20: the card's size and free share, the observations `sd_card_missing` and `sdfs_error`), so a card that holds such a report decodes here as on the server instead of failing the frame. The card's new root-level `sdcheck.bin`, the station's storage test file, is no station file and the card walk leaves it aside, as before. No code of the app changed.

## v0.14.0, 2026-10-19

### Added

- **The project follows the server by itself** (decision D29, Tim, 2026-10-19: a station or tracker added in Protect, or a map made, should reach the app without a hand on Server). While the app is online and signed in, the connection probe compares the loaded project's revision with the server's every five minutes (Protect's `GET /projects/{id}/field-bundle/revision`, Protect's decision D344) and, when it moved, loads the project again and reads the frames of trackers unknown before. A notice at the top of the page says when it happened and how many frames were read; the Server page's Project line says when the last comparison ran, or that the server's newer project could not be loaded. `GET /api/setup/connection` answers `bundle_checked_at`, `bundle_updated_at`, `bundle_outdated` and `frames_read_again`; the bundle summary carries `revision`. Protect pinned at d79ffaf still; a server without the revision endpoint is left as it is.

## v0.13.0, 2026-10-19

### Added

- **Unknown trackers** (Protect's decision D338, Tim, 2026-10-19: a card may name trackers Protect does not know yet). The Trackers page ends with the LP0 addresses the cards hold frames for that no device of the project has: the address, the tracker EUI when a v5 station wrote it, the frames, the stations that heard them, the last reception. "Add in Protect" opens the project's Offload page on the address, where the tracker is made with the DevEUI the card named; the Overview's Trackers button counts them. `GET /api/trackers/unknown`; the frames keep the tracker EUI (`source_eui`).
- **The frames of a tracker added since decode after the next load.** Loading the project again reads the frames of addresses unknown before from the kept files, for every address the fresh bundle knows now, and sums the cards' counts anew; no second import of the card. `POST /api/bundle/fetch` answers `frames_read_again`.

## v0.12.1, 2026-10-17

### Changed

- A sign-in with email and password now holds for weeks, as one from the Offload page does: the app exchanges the hour's token for the longer one through Protect's handoff endpoints right after the login. The Server page no longer shows the sign-in block an hour after you signed in (Tim, 2026-10-17).
- The project's loading moved onto the Server page, under the server and the account; "Load a project" left the sidebar, since a project belongs to a server (Tim, 2026-10-17).

## v0.12.0, 2026-10-17

### Added

- Export from the Data explorer (decision D27), after Protect's: the selection's records as CSV in the wide layout (a column per metric) or the long one (a row per value), or its positions as GeoJSON (a line per tracker, its fixes as points) or GPX (a track per tracker). The file comes from the laptop's own decoded data, times in UTC; Protect's export stays the one of record (Tim, 2026-10-17).

## v0.11.0, 2026-10-17

### Added

- A small map on the Overview with the offload stations, drawn as Protect draws them, and the last known position of every tracker the app knows, each in its colour; a click on a station or a tracker opens its page (Tim, 2026-10-17).
- Pages for the trackers and the offload stations (Tim, 2026-10-17): **Trackers** in the navigation lists every tracker the app knows, from the bundle and from the files, and a tracker's page shows what the bundle says of it, its last known position on the map, what the files brought and its measurements with their newest values, with the way to the Data explorer; **Offload stations** lists every station with where it stands and what its files brought, and a station's page shows its place, its counts, the batches read from it and its files. Every station and tracker name in the app, on the maps, in the files, the uploads and the explorer's layers, leads to its page, and the pages lead on to the explorer, the files and the upload.

## v0.10.3, 2026-10-17

### Changed

- The offload stations stand on the explorer's map with the same marker Protect draws them with: the LoRaWAN gateway icon in a rounded square with the green ring, the name under it (Tim, 2026-10-17). The icon comes from Protect's registry, which took it from EarthRanger (Apache-2.0, the licence shipped).

## v0.10.2, 2026-10-17

### Changed

- The explorer map's time slider sits on the scale's line at the bottom, between the scale and the control strip, so it covers nothing; the base map selector is gone, the base map follows the theme (Tim, 2026-10-17).

## v0.10.1, 2026-10-17

### Changed

- The explorer's map has a full screen button, as Protect's maps do, and "Fit the tracks" wears an icon that does not read as one (Tim, 2026-10-17: the fit button looked like full screen and did nothing of the kind).
- "Download and install" answers at once: the button says that the check runs, and when the newest release has no installer to fetch yet, because it is still being built, the notice says so instead of staying silent (Tim, 2026-10-17).

## v0.10.0, 2026-10-17

### Changed

- The Data explorer is Protect's Explore page in small (decision D25): the selection strip with the trackers, the period and the metrics, the tabs table, chart and map, the records table in a drawer under the chart and the map, and Protect's map controls on the offline tiles (zoom, north, fit the tracks, the Layers panel with the trackers and the base map's look, the stations as markers, the time slider). Every tracker and measurement is on until narrowed; the measurement chips and the newest-values table of v0.9.0 are gone (Tim, 2026-10-17: too complex, and the same experience as Protect wanted).

## v0.9.5, 2026-10-17

### Fixed

- An update asked "Also remove your Protect Go data?", with Yes as the way to lose everything (decision D24). An update never asks now and keeps the data; a real uninstall asks "Keep your Protect Go data?", where Yes and the default both keep it (Tim, 2026-10-17).

## v0.9.4, 2026-10-17

### Fixed

- After an update the window could keep showing the previous version's pages while the app reported the new version: the pages came from the window's cache (decision D23). The interface is served uncached now and the window empties its cache before it loads (Tim, 2026-10-17: "Open the SD card" still there on v0.9.3).

## v0.9.3, 2026-10-17

v0.9.1 and v0.9.2 were tagged but their Windows installer did not build (a variable declared twice in the installer script); this release carries both.

### Changed

- "Restart to update" keeps a window on the screen (decision D22): the installer shows its progress bar while the files change, closes by itself and starts the new version, so nothing goes dark between the steps (Tim, 2026-10-17). The running version decides how the installer is started, so the first update that behaves so is the one after v0.9.3.
- The Data explorer names and units the measurements as Protect does: the bundle carries Protect's metric registry (Protect's decision D334), served at `GET /api/bundle/metrics`. A bundle from an older server shows the keys as before; load the project again to get the names (Tim, 2026-10-17).

## v0.9.0, 2026-10-17

### Added

- The Data explorer (decision D21): the data that came with the files, explored as in Protect: the trackers as chips in their colours, the time window and the measurements to choose, the tracks on the offline map, one graph per measurement with a line per tracker, and the newest values. It takes the place of the Map and the tracker pages, whose addresses lead to it. The Files page's "Open the SD card" is gone; "Explore the data" and "What was read" stand there (Tim, 2026-10-17).

## v0.8.5, 2026-10-17

### Fixed

- After an update the new window could show the old interface: the installer closed the old window but its backend kept running on the port, and the new window used it (decision D20). The app now stops a backend of another version before starting its own, so what you see is always the version you installed. If an older backend will not stop, the app says so and names the way out.

### Changed

- "Load a project" moved under Settings, next to Server, since a project belongs to a server (Tim, 2026-10-17). The Overview's server card leads to the Server page alone; "Another server" lives there.

## v0.8.4, 2026-10-17

### Changed

- The notice's download buttons fetch this computer's installer straight from the newest release (`ProtectGo-Setup.exe`, the dmg or the deb) instead of opening the user page, with "All versions" beside them; the user page starts its Install section with a table of the three downloads (Tim, 2026-10-17: the page's links were inside its text).

## v0.8.3, 2026-10-17

### Fixed

- The self-update refused its own download: electron-updater demanded the publisher's signature on the installer, which the unsigned installers do not carry ("not signed by the application owner"). An unsigned build now says so and skips that check; a signed build keeps it (Tim, 2026-10-17). From v0.7.0 to v0.8.2 the update has to be installed by hand once more.

### Changed

- The download of an update shows a progress bar.
- The release check repeats every quarter hour and when the window regains focus, so a release made while the app runs shows soon; the start's answer stood for an hour (Tim, 2026-10-17).

## v0.8.2, 2026-10-17

### Changed

- "Check for updates…" in the menu answers on whatever page is open: a note at the top says that the check runs, then that the app is up to date, that a newer version exists with the way to it, or that the check failed (Tim, 2026-10-17: nothing came back, not even "up to date").
- A release is published only once its installers are attached (decision D19): the workflow builds on the pushed tag and takes the release out of draft at the end. An installed app that checked while the files were still being built got "Cannot find latest.yml" (Tim, 2026-10-17).

## v0.8.1, 2026-10-17

### Changed

- The full screen note is a short pill at the top centre, away from the connection dot, and fades after a few seconds; the pointer at the top edge brings it back (Tim, 2026-10-17).

## v0.8.0, 2026-10-17

### Changed

- The Server page shows what the app is connected to (decision D18): the server with its Protect version, whether it answers right now with the time of the last check and a "Check now", and the account on that server, signed in until when, with Sign out and Sign in as someone else; the forms appear only when something is to be changed or the sign-in has run out. Account left the sidebar; it lives on the Server page. The top bar's dot follows the live state: green online and signed in, amber online without a sign-in, grey when the server does not answer.

## v0.7.0, 2026-10-17

### Added

- The app updates itself on Windows (decision D17): the notice's "Download and install" fetches the new version in the background and "Restart to update" installs it and opens the app again; a finished download installs on quit too. The release carries `latest.yml` and the blockmap beside the Windows installer for this. macOS waits for code signing, which it demands for self-updates; the Debian package keeps the download link.

## v0.6.0, 2026-10-17

### Added

- The SD card found by itself (decision D16): the Files page lists the removable drives in the computer with the station files found on them, and "Read this SD card" reads the whole card at once; "Pick the card's folder" opens the system's folder dialog for a copy of the card. The way out of full screen: Esc or F11 leaves it, and a bar on the page offers a button, since the menu bar disappears in full screen on Windows.
- Signed in from Protect's Offload page (decision D15): the `protect-go://connect` link carries a one-time code beside the server, the app exchanges it at `POST /api/v1/auth/go-handoff/exchange` for a token of 30 days and lands on Overview; nothing is typed. Email and password stay as the way in when the app was not opened from that page. Protect's side is its decision D333.

### Changed

- The app icon is the Smart Parks logo with its name, white on brand green, instead of the mark alone.
- The user guide tells Windows 11 users with Smart App Control what to do, since it blocks an unsigned app with no way to run it anyway.

## v0.5.0, 2026-10-17

Protect's file explorer for the files; only projects with an offload station are offered. Protect pinned at d79ffaf.

### Changed

- The Files page is Protect's file explorer (decision D14): one line per file with its SD card, station, upload state, frames, positions and size, or tiles, with a search, a column picker and the view remembered; a click opens the file's properties with the counts, the trackers, what could not be read and the way to its SD card's page. The SD card is a filter above the list.
- Loading a project offers only the projects that have an offload station, since a project without one has no card to read; the page says how many it left out.

## v0.4.0, 2026-10-17

Protect's shell and words, and the project map. Protect pinned at d79ffaf.

### Added

- The project map (decision D4, phase 2 F3): every tracker's track from the files on the laptop in its own colour over the offline map, a tracker and a time window to choose, a click on a fix for who and when. A page per tracker with its track, the metrics it reported with their newest values, and one metric's values as a table.

### Changed

- The app wears Protect's shell (decision D13): the same sidebar and drawer, top bar with the logo, page headers, theme switch and language choice, so the pages look and navigate as Protect's do.
- The SD card's files are called files, never cards: the Files page, "Read SD card files", "Files on this laptop"; in Dutch "bestanden", so the map ("kaart") is the only map.

## v0.3.0, 2026-10-17

### Changed

- The app is Protect Go (decision D12): the installers are `ProtectGo-Setup.exe`, `ProtectGo-arm64.dmg` and `ProtectGo-amd64.deb`, the data folder `ProtectGo` in your home folder, the link from Protect's Offload page `protect-go://`. Install this version over Protect Field; the server, your sign-in and the project you loaded are kept in the old folder `ProtectField`, so load the project again once (a minute online), and read any card you had read again if you still have it. Every text names the app once and says "the app" after that.

## v0.2.0, 2026-10-17

The whole cycle: load a project, read a card offline, see it on the map, upload it. Protect pinned at d79ffaf.

### Added

- The upload to Protect: the Upload page sends the card files that wait to the server, one by one and exactly as they were on the card, and keeps the server's answer on each: taken, had already, refused. A sign-in that expired stops the run and says so; a card whose station the project does not know waits until the station is made on Protect's Offload page.
- Reading a card: drop a card's LOG folders or a zip of them on the Cards page; every frame is read with the project's keys through Protect's own decode path, the records kept on the laptop, the positions drawn on the offline map, and every frame that could not be read listed with the server's own reason. The files are kept as they were for the upload.
- Loading a project (decision D11): the Load page fetches the project's field bundle from the Protect server, the devices, entities, stations and the LP0 keys the account may see, and the map with it, in one button; the bundle is kept encrypted on the laptop with a key in the operating system's keychain, or in a key file where there is none, and the first screen says what is on the laptop and warns after a week.
- Protect pinned at d79ffaf (main of 2026-10-17), which brings `shared.station_decode`, the one decode path of a station frame the server's pipeline and Protect Go share; the proof test opens a frame and reads a stored stream through it.
- The offline map (decision D4): the Map page fetches the project's PMTiles map from the Protect server while online (asking the server to cut it when it has none yet) and draws it on the laptop without a connection, with Protomaps' basemap style and its sprites and glyphs shipped inside Protect Go; the backend serves the file with range requests. The account's projects are listed for the picker.

## v0.1.0, 2026-10-17

The first release: the installers and the first-run setup. Reading a card, the map and the upload queue come in the next releases.

### Added

- The repository: Protect's conventions mirrored, the git hooks, CI (ruff, mypy, pytest; the frontend's lint, catalogue check, build and tests; the documentation site built strictly; a dependency audit), Dependabot for security updates, MIT licence (2026-10-17).
- The Python package `protect_go` with a local FastAPI server (`/api/health` naming the version and the Protect commit) that serves the built interface, settings under `FIELD_`, and the dependency on Protect's `shared` package pinned by commit (decision D1). A test proves Protect's LP0 codec and OpenCollar driver work here with no database, broker or Protect settings.
- The frontend skeleton on Protect's stack (React 19, Vite, TypeScript strict, Tailwind 4, shadcn/ui, TanStack Query, React Router, i18next with English as the key and Dutch beside it) with Protect's colour tokens and its first screen.
- `scripts/dev.sh` with `run`, `test`, `lint`, `format`, `docs`, `hooks` and `bump-protect`, which moves the Protect pin and reruns the decoding proof.
- The documentation site: the contract with Protect (the field bundle down, the card files up), ADR 0001, and a user page (where Protect Go runs, how to install it, the cycle of bundle, card and upload), published from `main`.

- Installers after AddaxAI's (decision D6): an Electron shell (`electron/`) that starts the PyInstaller-frozen backend (`backend.spec`) and shows the interface; electron-builder makes `ProtectGo-Setup.exe` (Windows, per user), `ProtectGo-arm64.dmg` (macOS, Apple Silicon) and `ProtectGo-amd64.deb`; the workflow `build-installers.yml` builds them when a release is published and attaches them, signed and notarised when the certificates are present. The Smart Parks mark on brand green as the icon.
- The first-run setup (decision D7): the Protect server, checked by its `/api/version`, then the account's email and password through Protect's own login; the token is kept in the data folder, the password never. `protect-go://connect?server=…` opens Protect Go with the server filled in (decision D9), for Protect's Offload page.
- The update notice (decision D8): at start Protect Go looks at the newest release on GitHub and shows a newer version with its notes and a download button; Check for updates in the menu does the same.
- Protect pinned at 8c0a6b6 (main of 2026-10-17), which brings `shared.station_files`, the parser without a database, and the field bundle endpoint; the proof test parses a station line with it.

Protect pinned at 8c0a6b6 (main of 2026-10-17).
