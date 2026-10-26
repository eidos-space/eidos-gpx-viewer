# GPX Viewer

Explore GPX tracks, routes and waypoints in a read-only file View.

Requires **Eidos Lite 0.29.0 or later**, with Plugin API **3.7.0**, WebGL and bundled browser workers. Install from Marketplace or the project's GitHub Release, enable it in the Space, open a `.gpx` file and choose **GPX Map**. The plugin ID is `eidos.gpx-viewer`; packages with a different ID are separate installations.

Names, controls, messages and bundled documentation follow the host language. Changing language preserves the selected point, playback state and map position without rereading the file.

## Explore a route

- Choose a route when the file contains several tracks, routes or waypoint collections. Fit shows the selected route.
- Drag the timeline to inspect coordinates, timestamps, elevation and speed. Play at 1×, 10×, 60× or 300× using recorded timestamps.
- Missing, duplicate or decreasing timestamps disable playback while point browsing remains available. Segment gaps are retained.
- Details shows point/segment counts and elevation/speed charts. Charts use point index; missing values and segment boundaries break curves.
- Speed comes from Waylog's extension or GPX 1.0 when present, otherwise it is estimated between adjacent timestamped points in the same segment.
- Reload rereads the file. A failed reload retains the last successful content and shows an error. Retry basemap reloads tiles without rereading GPX.

## Format, privacy and limits

Supports UTF-8 GPX 1.0/1.1, default/prefixed namespaces, `trk`/`trkseg`, `rte` and `wpt`. A missing namespace is accepted with a warning. Core `ele` represents elevation; ellipsoid altitude does not replace missing elevation. Unknown extensions are ignored.

Limits are 16 MiB and 100,000 points. Invalid coordinates are skipped with a warning and break the line. DTD/entity declarations are rejected. Drawing splits longitude wraparound; fitting a dateline-crossing route can show a wide world view.

The plugin reads only its bound file and cannot edit it. OpenFreeMap receives viewport tile requests and normal network metadata; GPX bytes stay local unless you explicitly publish the file. A publication includes a readable hosted copy of the file and plugin. Tracks, charts and playback work when tiles fail. No offline-region downloading is provided. CLI Serve and current mobile hosts do not support this archive; existing older installations remain usable.

MapLibre's BSD license and OpenFreeMap/OpenMapTiles/OpenStreetMap attribution are retained.

## Development

Use Node.js 22.12 or later and SDK/tools 0.9.0. Run `npm ci`, `npm run prepare:map`, `npm test`, `npm run check -- --target lite` and `npm run pack:plugin`. Browser tests use Google Chrome and synthetic GPX data.
