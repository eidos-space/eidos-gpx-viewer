# GPX Viewer 0.1.3

Open GPX tracks, routes and waypoints as a read-only interactive map in Eidos Lite.

- Explore separate track segments, distance, elevation and recorded speed.
- Seek through track points and play routes with complete, increasing timestamps.
- Render OpenFreeMap vector streets with Retina support and retained attribution.
- Keep track browsing and charts available when the online basemap fails.

Requires Plugin API 3.0.0 or later, browser workers and WebGL. Reads only the opened GPX file and requests the OpenFreeMap tile origin. Files are limited to 16 MiB and 100,000 points. CLI Serve is unsupported; Android and iOS are unverified.

GPX files stay local in Lite unless explicitly published. The published View reads the hosted file copy. Ordinary-file publishing requires a compatible desktop release or the Eidos CLI.
