import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
// Embed the locked worker into the self-contained Eidos package. No CDN code.
const result = await build({ entryPoints: ['node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs'], bundle: true, format: 'iife', write: false, minify: true, legalComments: 'inline' })
const worker = result.outputFiles[0].text.replace(/\/\/# sourceMappingURL=.*$/gm, '')
await writeFile('src/map-worker.json', JSON.stringify(worker) + '\n')
// Opaque sandbox origins cannot load module blob workers in Chromium. Our
// self-contained IIFE worker is a classic worker. Scope this adapter to the
// library module; never replace the host/global Worker or relax the CSP.
// Use the configured blob directly: location.origin still reports the document
// URL's origin in an opaque iframe, causing MapLibre to wrap blob:null URLs in
// an ESM import shim that cannot run as a classic worker.
await build({
  stdin: { contents: 'export { Map, Marker, NavigationControl, LngLatBounds, setWorkerCount } from "maplibre-gl"; import { setWorkerUrl as setLibraryWorkerUrl, setBundledWorkerUrl } from "maplibre-gl"; export function setWorkerUrl(url) { setBundledWorkerUrl(url); setLibraryWorkerUrl(url); }', resolveDir: process.cwd(), loader: 'js' },
  bundle: true, format: 'esm', outfile: 'src/map-runtime.js', minify: true, legalComments: 'inline',
  banner: { js: '// @ts-nocheck\n// Generated upstream vendor code. Run npm run prepare:map; see map-runtime.d.ts for API types.' },
  plugins: [{ name: 'classic-sandbox-worker', setup(build) {
    build.onLoad({ filter: /maplibre-gl\.mjs$/ }, async ({ path }) => ({
      contents: 'let bundledWorkerUrl; export function setBundledWorkerUrl(url) { bundledWorkerUrl = url; }\nconst Worker = class extends globalThis.Worker { constructor(url, _options) { super(bundledWorkerUrl ?? url); } };\n' + await readFile(path, 'utf8'), loader: 'js', resolveDir: new URL('.', 'file://' + path).pathname,
    }))
  } }],
})
const license = await readFile('node_modules/maplibre-gl/LICENSE.txt', 'utf8')
await writeFile('THIRD_PARTY_NOTICES.txt', license)
