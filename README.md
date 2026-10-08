# GPX Viewer for Eidos Lite

A read-only file View for GPX tracks, routes and waypoints. Open a `.gpx` file in Eidos Lite and choose **Open with → GPX 地图**.

## Install

Requires Eidos Lite with Plugin API **3.0.0 or newer**. CLI Serve does not support this file View.

In Lite's Plugin Manager, find **GPX Viewer** in the Marketplace, install it, review its access and enable it for the desired Space. You can also install `local.eidos-gpx-viewer-0.1.3.eidos-plugin` from the [GitHub Release](https://github.com/eidos-space/eidos-gpx-viewer/releases/tag/v0.1.3). An update may request renewed review for its bundled workers and the OpenFreeMap network origin. Put a GPX file in that Space, open it and choose GPX 地图. The adjacent `.sha256` file verifies the archive. For development, choose **Load development source** and select this project's `plugin.json`.

Android and iOS support has not been verified for this release.

## Explore a track

- The map uses OpenFreeMap vector streets and labels, rendered at the display's pixel density for sharp Retina/HiDPI output. It shows separate track segments, a green start and orange finish. Drag and zoom normally; **全程** fits the selected route.
- The compact header shows the filename, distance and duration. A route selector appears only when the file contains multiple tracks, routes or waypoint collections. Distance excludes gaps between segments and invalid points.
- Drag the timeline to inspect coordinates, timestamps, elevation and speed. Blue marks the selected point.
- Play at 1×, 10×, 60× or 300×. Playback follows recorded timestamps and moves between recorded points; it does not invent positions inside gaps. Missing, duplicate or decreasing timestamps disable time playback while point browsing remains available.
- **详情** expands coordinates, timestamps, point and segment counts, and elevation/speed charts; it is collapsed by default to leave more room for the map. Charts use point index on the horizontal axis. Missing values and segment boundaries break the curves. Speed is taken from Waylog's extension or GPX 1.0's speed field when available, otherwise estimated between consecutive timestamped points in the same segment.
- **刷新** rereads a file changed on disk. If rereading fails, the last successfully loaded view remains visible with an explicit message. Warnings remain visible outside the details panel.

## Format and privacy

Supports UTF-8 GPX 1.0 and 1.1, prefixed/default namespaces, multiple `trk` / `trkseg`, `rte` and `wpt`. Namespace-less GPX is accepted with a warning. The core `ele` field is treated as elevation; Waylog ellipsoid altitude is not substituted for missing mean-sea-level elevation. Unknown extensions are ignored. This viewer reads GPX; it does not certify schema conformance.

Limits: 16 MiB and 100,000 points per file. Invalid coordinates are skipped with a warning and split the line. XML with DTD/entity declarations is rejected. Longitude wraparound is split for drawing; fitting a dateline-crossing route may show a wide world view.

The plugin only reads its bound file, declares `https://tiles.openfreemap.org`, and enables bundled workers for map decoding. It cannot edit the file and requests no access to other files, credentials or accounts. In Lite, GPX bytes stay local. If you explicitly publish a GPX file with this View, Publish saves the file and plugin in the hosted publication; visitors can read that published copy. Publishing support depends on the host version; use the Eidos CLI when the desktop publishing entry point is unavailable. The tile service receives the requested viewport tile coordinates and normal network metadata. Tiles, glyphs and sprites require networking; tracks, charts and playback remain usable when tiles fail. **重试底图** retries the basemap without rereading GPX. Browser HTTP caching is used. No offline-region downloads are implemented. WebGL must be enabled to render the map.

The public [OpenFreeMap service](https://openfreemap.org/) is best-effort. Coordinate and file semantics follow the [GPX specification](https://www.topografix.com/GPX/1/1/); map rendering uses [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/). The bundled Liberty style comes from `https://tiles.openfreemap.org/styles/liberty` (retrieved 2026-10-01). Street layers are vectors; the low-zoom shaded world overview is a raster layer. Attribution is retained for OpenFreeMap, OpenMapTiles and OpenStreetMap.

## Develop and validate

Node >=22.12; Google Chrome is used by the browser tests.

```sh
npm ci
npm run prepare:map
npm test
npm run check -- --target lite --json
npm run pack:plugin -- --json
```

To use the matching Eidos checkout tools:

```sh
node ../../eidos/packages/plugin-tools/bin/eidos-plugin.mjs check . --target lite --json
node tests/sandbox.mjs
node ../../eidos/packages/plugin-tools/bin/eidos-plugin.mjs pack . --json
```

`EIDOS_CHECKOUT` overrides `../../eidos` for the sandbox test. The checkout's plugin runtime must be built. Tests cover parser edge cases, Waylog-style extensions in a generated fixture, timeline controls, missing fields, failed reload, lifecycle cleanup, responsive layouts, real vector tiles, offline browsing and a 2× canvas pixel ratio. The sandbox test uses Eidos's compiled View bootstrap, its opaque-origin iframe and CSP, with a fixture-only mock filesystem RPC. Artifacts and screenshots are written to `artifacts/`. All committed sample coordinates and timestamps are synthetic.

Desktop acceptance on 2026-10-08 used an isolated Eidos Lite 0.22.1 development profile, the exact 0.1.3 archive, and generated GPX data. Installation, enablement, **Open with → GPX 地图**, and the map were exercised through the desktop UI. Publish acceptance covered a working hosted map and republishing the same Version. Android and iOS remain unverified.

MapLibre's BSD license is retained in bundled code and `THIRD_PARTY_NOTICES.txt`. `prepare:map` generates the worker and runtime from the locked dependency. The worker is bundled as a classic IIFE; a library-scoped Worker adapter loads it in Eidos's opaque-origin sandbox. It does not replace the global Worker or weaken the host CSP. Re-run generation after changing MapLibre or the bundler version.
