import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
const parserBuild = await build({ entryPoints: ['src/gpx.ts'], bundle: true, write: false, format: 'iife', globalName: 'GPX' })
await mkdir('artifacts', { recursive: true })
await build({ entryPoints: ['tests/harness.ts'], bundle: true, outdir: 'artifacts/harness', format: 'iife' })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 }, deviceScaleFactor: 2 })
  let vectorResponses = 0
  page.on('response', response => { if (response.ok() && /\/planet\/.*\.pbf$/.test(response.url())) vectorResponses++ })
  await page.addScriptTag({ content: parserBuild.outputFiles[0].text })
  const results = await page.evaluate(() => {
    const wrap = content => `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">${content}</gpx>`
    const point = (lat, lon, extra = '') => `<trkpt lat="${lat}" lon="${lon}">${extra}</trkpt>`
    const results = []
    const test = (name, fn) => { fn(); results.push(name) }
    const check = (condition, message) => { if (!condition) throw Error(message) }
    test('segments and missing elevation remain independent', () => {
      const r = GPX.parseGpx(wrap(`<trk><trkseg>${point(0, 0)}${point(0, .001)}</trkseg><trkseg>${point(30, 30)}</trkseg></trk>`)).routes[0]
      check(r.distance > 110 && r.distance < 112, 'gap counted as distance')
      check(r.points[0].elevation === null && !r.timed, 'missing values fabricated')
      check(GPX.mapLines(r.points).length === 2, 'segments connected')
    })
    test('invalid coordinates break geometry', () => {
      const file = GPX.parseGpx(wrap(`<trk><trkseg>${point(0, 0)}${point('', 1)}${point(0, .001)}</trkseg></trk>`))
      check(file.routes[0].distance === 0 && file.warnings.length === 1, 'invalid point bridged')
    })
    test('Waylog speed and ellipsoid altitude', () => {
      const r = GPX.parseGpx(wrap(`<trk><trkseg>${point(0, 0, '<extensions xmlns:w="urn:waylog:gpx:1"><w:speedMetersPerSecond>2.5</w:speedMetersPerSecond><w:ellipsoidAltitudeMeters>80</w:ellipsoidAltitudeMeters></extensions>')}</trkseg></trk>`)).routes[0]
      check(r.points[0].speed === 2.5 && r.points[0].measuredSpeed && r.points[0].elevation === null, 'extension semantics wrong')
    })
    test('time playback uses timestamps, not point spacing', () => {
      const r = GPX.parseGpx(wrap(`<trk><trkseg>${point(0, 0, '<time>2026-01-01T00:00:00Z</time>')}${point(0, .001, '<time>2026-01-01T00:00:10Z</time>')}${point(0, .002, '<time>2026-01-01T00:02:00Z</time>')}</trkseg></trk>`)).routes[0]
      check(r.timed && GPX.indexAtTime(r.points, r.points[0].time + 60000) === 1, 'time seeking wrong')
      check(r.points[1].speed > 11 && r.points[1].speed < 12, 'derived speed wrong')
    })
    test('duplicate timestamps disable playback', () => {
      const p = point(0, 0, '<time>2026-01-01T00:00:00Z</time>')
      check(!GPX.parseGpx(wrap(`<trk><trkseg>${p}${p}</trkseg></trk>`)).routes[0].timed, 'duplicate time accepted')
    })
    test('GPX 1.0 routes, waypoints and namespace prefixes', () => {
      const f = GPX.parseGpx('<g:gpx xmlns:g="http://www.topografix.com/GPX/1/0" version="1.0"><g:rte><g:rtept lat="0" lon="0"><g:speed>3</g:speed></g:rtept></g:rte><g:wpt lat="1" lon="2"/></g:gpx>')
      check(f.routes.length === 2 && f.routes[0].points[0].speed === 3, 'GPX 1.0 failed')
    })
    test('dateline split and short geographic distance', () => {
      const r = GPX.parseGpx(wrap(`<trk><trkseg>${point(0, 179.99)}${point(0, -179.99)}</trkseg></trk>`)).routes[0]
      check(r.distance < 2300 && GPX.mapLines(r.points).length === 2, 'dateline line crosses world')
    })
    test('malformed XML, foreign XML and DTD rejected', () => {
      for (const source of ['<gpx><trk></gpx>', '<html/>', '<gpx xmlns="urn:foreign"/>', '<!DOCTYPE gpx [<!ENTITY x "test">]><gpx/>']) {
        let failed = false; try { GPX.parseGpx(source) } catch { failed = true }; check(failed, 'unsafe/invalid XML accepted')
      }
    })
    test('empty and hostile names rendered as plain data', () => {
      check(GPX.parseGpx(wrap('')).routes.length === 0, 'empty file failed')
      check(GPX.parseGpx(wrap(`<trk><name>&lt;img src=x onerror=alert(1)&gt;</name><trkseg>${point(0, 0)}</trkseg></trk>`)).routes[0].name.startsWith('<img'), 'name altered')
    })
    return results
  })
  const fixture = await readFile('fixtures/synthetic.gpx', 'utf8')
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<html><head></head><body><div id="app"></div></body></html>')
  await page.evaluate(fixture => { window.fixture = fixture }, fixture)
  await page.addStyleTag({ path: 'artifacts/harness/harness.css' })
  await page.addScriptTag({ path: 'artifacts/harness/harness.js' })
  await page.waitForFunction(() => document.querySelector('#app').dataset.loaded === 'true')
  assert.equal(await page.locator('#track-details').isVisible(), false)
  assert.equal(await page.locator('#routes').isVisible(), false)
  assert.equal(await page.locator('#routes option').count(), 1)
  await page.locator('#scrub').fill('7'); assert.match(await page.locator('#position').innerText(), /^8 \/ /)
  await page.getByRole('button', { name: '播放', exact: true }).click()
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor()
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('#map').dataset.mapReady === 'true', null, { timeout: 60000 })
  assert.equal(await page.locator('#map-status').innerText(), '')
  assert.ok(vectorResponses > 0, 'No actual vector tiles loaded')
  assert.equal(await page.locator('.maplibregl-canvas').evaluate(canvas => canvas.width / canvas.clientWidth), 2, 'Map must render at Retina resolution')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.screenshot({ path: 'artifacts/viewer-light.png', fullPage: true })
  await page.getByRole('button', { name: '详情', exact: true }).focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('#track-details').isVisible(), true)
  assert.equal(await page.locator('#toggle-details').getAttribute('aria-expanded'), 'true')
  await page.screenshot({ path: 'artifacts/viewer-details.png', fullPage: true })
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('#track-details').isVisible(), false)
  await page.evaluate(() => { document.documentElement.style.cssText = '--eidos-color-scheme:dark;--eidos-foreground:#e5e8e3;--eidos-background:#202420;--eidos-border:#3e453d;--eidos-muted:#aab3a7;--eidos-surface-hover:#343b33' })
  await page.screenshot({ path: 'artifacts/viewer-dark.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.screenshot({ path: 'artifacts/viewer-narrow.png', fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.evaluate(() => { window.fixture = '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="0" lon="0"/></trkseg></trk></gpx>' })
  await page.getByRole('button', { name: '重新读取' }).click()
  await page.waitForFunction(() => document.querySelector('#position').textContent.startsWith('1 / 1'))
  assert.equal(await page.locator('#play').isDisabled(), true)
  assert.match(await page.locator('figure').first().textContent(), /未记录/)
  await page.evaluate(() => { window.fixture = '<broken>' }); await page.getByRole('button', { name: '重新读取' }).click()
  await page.getByText(/当前仍显示上次成功读取/).waitFor()
  await page.context().route('https://tiles.openfreemap.org/**', route => route.abort())
  await page.locator('#retry-map').evaluate(button => button.click())
  await page.locator('#map-status').filter({ hasText: '底图加载失败' }).waitFor()
  await page.locator('#scrub').fill('0')
  assert.match(await page.locator('#position').innerText(), /^1 \/ 1/)
  await page.evaluate(() => window.unmount()); assert.equal(await page.locator('#app').innerHTML(), '')
  assert.deepEqual(errors, [])
  results.push('UI: load, seek, play/pause, real vector tiles, Retina 2× canvas, light/dark/narrow, offline browsing, missing fields, failed reload, disposal')
  await writeFile('artifacts/verification.json', JSON.stringify({ passed: results, host: 'Chromium harness; Eidos host validation separate' }, null, 2))
  console.log(JSON.stringify({ passed: results }, null, 2))
} finally { await browser.close() }
