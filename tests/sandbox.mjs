import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
const checkout = process.env.EIDOS_CHECKOUT ?? '../../eidos'
const { compilePlugin } = await import(pathToFileURL(resolve(checkout, 'packages/plugin-runtime/dist/compiler.js')))
const { viewHtml, sandboxCsp } = await import(pathToFileURL(resolve(checkout, 'packages/plugin-runtime/dist/sandbox.js')))
const compiled = await compilePlugin(process.cwd())
const bytes = await readFile('fixtures/synthetic.gpx')
const html = viewHtml(compiled.program.modules['./src/main.ts'], { kind: 'file', path: '旅行/上海/trip.gpx', name: 'trip.gpx', baseName: 'trip', extension: '.gpx', mimeType: 'application/gpx+xml', size: bytes.length })
const methods = []
const server = createServer(async (request, response) => {
  if (request.url === '/guest') {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': sandboxCsp(compiled.program.manifest.browser) }); response.end(html); return
  }
  if (request.url === '/rpc') {
    let body = ''; for await (const chunk of request) body += chunk
    const call = JSON.parse(body); methods.push(call.method)
    const result = call.method === 'fs.readBinary' && call.params.path === 'trip.gpx' ? { data: bytes.toString('base64') } : null
    const error = !['fs.readBinary', 'view.ready'].includes(call.method) || (call.method === 'fs.readBinary' && call.params.path !== 'trip.gpx') ? { code: 'PERMISSION_DENIED', message: 'Access outside file directory denied' } : undefined
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ protocol: 'eidos-plugin', apiVersion: 1, id: call.id, result, error })); return
  }
  response.setHeader('Content-Type', 'text/html')
  response.end(`<!doctype html><style>body{margin:0}iframe{border:0;width:100vw;height:100vh;display:block}</style><iframe sandbox="allow-scripts" src="/guest"></iframe><script>
    const frame=document.querySelector('iframe');addEventListener('message',async event=>{
      if(event.source!==frame.contentWindow||event.data.protocol!=='eidos-plugin')return;
      const response=await fetch('/rpc',{method:'POST',body:JSON.stringify(event.data)});event.source.postMessage(await response.json(),'*');
    });</script>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
// Set the browser's display density too: page-level emulation does not reach
// Chromium's separate opaque-iframe renderer process.
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-device-scale-factor=2'] })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 }, deviceScaleFactor: 2 })
  let vectorResponses = 0
  page.on('response', response => { if (response.ok() && /\/planet\/.*\.pbf$/.test(response.url())) vectorResponses++ })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()) })
  page.on('requestfailed', request => console.error(request.url(), request.failure()))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const guest = page.frameLocator('iframe')
  await guest.locator('#app[data-loaded="true"]').waitFor()
  assert.equal(await guest.locator('#routes option').count(), 1)
  await guest.locator('#scrub').fill('7')
  assert.match(await guest.locator('#position').innerText(), /^8 \/ 25/)
  await guest.getByRole('button', { name: '播放', exact: true }).click()
  await guest.getByRole('button', { name: '暂停', exact: true }).click()
  const frame = page.frames().find(f => f.url().endsWith('/guest'))
  await frame.waitForFunction(() => document.querySelector('#map').dataset.mapReady === 'true', null, { timeout: 60000 })
  assert.equal(await guest.locator('#map-status').innerText(), '')
  assert.ok(vectorResponses > 0)
  assert.equal(await frame.evaluate(() => devicePixelRatio), 2)
  assert.equal(await guest.locator('.maplibregl-canvas').evaluate(canvas => canvas.width / canvas.clientWidth), 2)
  assert.equal(await frame.evaluate(() => { try { void parent.document.body; return false } catch { return true } }), true)
  await page.screenshot({ path: 'artifacts/viewer-sandbox.png' })
  assert.deepEqual(errors, [])
  assert.deepEqual([...new Set(methods)].sort(), ['fs.readBinary', 'view.ready'])
  const report = { passed: true, scope: 'Actual Eidos view bootstrap, opaque iframe CSP, bundled blob workers, fs.readBinary RPC, packaged code, real OpenFreeMap vector tiles, Retina canvas, seek/play. Mock file service; not Electron Lite UI.', methods: [...new Set(methods)] }
  await writeFile('artifacts/sandbox-verification.json', JSON.stringify(report, null, 2)); console.log(report)
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
