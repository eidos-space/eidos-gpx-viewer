import type { ViewContext } from "@eidos.space/plugin-sdk"
import { RouteMap } from "./map"
import "./style.css"
import { parseGpx, indexAtTime, type Route } from "./gpx"

export default async function mount(ctx: ViewContext, root: HTMLElement) {
  const t = ctx.i18n.t
  if (ctx.binding.kind !== "file" || !ctx.capabilities.fs) throw Error(t("ui.boundFile"))
  const fs = ctx.capabilities.fs, path = ctx.binding.file.path ?? ctx.binding.file.id
  // Bound-file fs paths are relative to the bound file's directory, while
  // binding.file.path describes its location relative to the Space root.
  const filename = path.split("/").at(-1)!
  root.classList.add("gpx-viewer")
  root.innerHTML = `<header><div class="identity"><span id="filename"></span><span id="overview"></span></div><select id="routes" aria-label="${t("ui.chooseRoute")}" hidden></select><button id="reload" aria-label="${t("ui.reloadLabel")}" title="${t("ui.reloadTitle")}">${t("ui.reload")}</button><button id="fit" aria-label="${t("ui.fitTitle")}">${t("ui.fit")}</button></header>
    <div class="message" role="status" aria-live="polite">${t("ui.loading")}</div>
    <div class="map-notice"><span id="map-status" role="status"></span><button id="retry-map">${t("ui.retryMap")}</button></div>
    <div id="map" role="region" aria-label="${t("ui.map")}"></div>
    <section class="timeline" aria-label="${t("ui.playback")}"><div class="controls"><button id="play" disabled>${t("ui.play")}</button><select id="rate" aria-label="${t("ui.rate")}"><option value="1">1×</option><option value="10">10×</option><option value="60" selected>60×</option><option value="300">300×</option></select><input id="scrub" type="range" min="0" max="0" value="0" aria-label="${t("ui.points")}" disabled><span id="position">${t("ui.noSelection")}</span><button id="toggle-details" aria-expanded="false" aria-controls="track-details">${t("ui.details")}</button></div>
    <div id="track-details" hidden><dl id="summary"></dl><p id="details"></p><div class="charts"><figure><figcaption>${t("ui.elevationCaption")}</figcaption><svg id="elevation" viewBox="0 0 600 90" role="img" aria-label="${t("ui.elevationChart")}"></svg></figure><figure><figcaption>${t("ui.speedCaption")}</figcaption><svg id="speed" viewBox="0 0 600 90" role="img" aria-label="${t("ui.speedChart")}"></svg></figure></div><p class="hint" id="time-note"></p><p class="hint" id="privacy">${t("ui.privacy")}</p></div><p id="playback-note" class="hint"></p></section>`
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  get("#filename").textContent = ctx.binding.file.name ?? path
  get("#filename").title = ctx.binding.file.name ?? path
  const status = get(".message"), select = get<HTMLSelectElement>("#routes"), slider = get<HTMLInputElement>("#scrub"), play = get<HTMLButtonElement>("#play"), rate = get<HTMLSelectElement>("#rate")
  const map = new RouteMap(get("#map"), get("#map-status"), ctx.i18n)
  let routes: Route[] = [], route: Route | undefined, selected = 0, frame = 0, disposed = false, generation = 0
  let playing = false, clock = 0, lastFrame = 0
  let cachedSource = "", failedSource: string | null = null, failure: unknown = null
  const format = (n: number | null, suffix: string) => n === null ? t("ui.notRecorded") : `${n.toFixed(1)} ${suffix}`
  function stop() { playing = false; cancelAnimationFrame(frame); play.textContent = t("ui.play") }
  function fit() { map.fit() }
  function chart(id: string, key: "elevation" | "speed") {
    const svg = root.querySelector<SVGSVGElement>(id)!; svg.replaceChildren()
    const element = (name: string, attrs: Record<string, string>) => { const node = document.createElementNS("http://www.w3.org/2000/svg", name); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); svg.append(node); return node }
    const values = route!.points.map(p => p[key] === null ? null : p[key]! * (key === "speed" ? 3.6 : 1))
    let min = Infinity, max = -Infinity
    for (const value of values) if (value !== null) { min = Math.min(min, value); max = Math.max(max, value) }
    const caption = svg.previousElementSibling!
    caption.textContent = `${key === "speed" ? t("ui.speedCaption") : t("ui.elevationCaption")} · ${Number.isFinite(min) ? `${min.toFixed(2)} — ${max.toFixed(2)}` : t("ui.missingMetric")}`
    if (!Number.isFinite(min)) return
    let d = "", previous = false
    values.forEach((value, index) => {
      if (value === null) { previous = false; return }
      const x = 8 + 584 * index / Math.max(1, values.length - 1), y = 72 - 54 * (value - min) / (max - min || 1)
      const connected = previous && route!.points[index - 1]!.segment === route!.points[index]!.segment
      d += `${connected ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)} `; previous = true
    })
    element("path", { d, fill: "none", stroke: "var(--route-color)", "stroke-width": "2", "vector-effect": "non-scaling-stroke" })
    element("line", { class: "chart-cursor", x1: "8", x2: "8", y1: "18", y2: "80", stroke: "currentColor", "stroke-dasharray": "3 3" })
  }
  function show(index: number) {
    if (!route) return
    selected = Math.max(0, Math.min(index, route.points.length - 1)); slider.value = String(selected)
    const p = route.points[selected]!
    map.show(p)
    get("#position").textContent = `${selected + 1} / ${route.points.length}${p.time === null ? "" : ` · ${new Date(p.time).toLocaleTimeString(ctx.i18n.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}`}`
    get("#details").textContent = `${p.time === null ? t("ui.missingTime") : new Date(p.time).toLocaleString(ctx.i18n.locale)} · ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)} · ${(p.distance / 1000).toFixed(2)} km · ${t("ui.elevation")} ${format(p.elevation, "m")} · ${p.measuredSpeed ? t("ui.measuredSpeed") : t("ui.estimatedSpeed")} ${format(p.speed === null ? null : p.speed * 3.6, "km/h")}`
    const x = String(8 + 584 * selected / Math.max(1, route.points.length - 1))
    root.querySelectorAll(".chart-cursor").forEach(line => { line.setAttribute("x1", x); line.setAttribute("x2", x) })
  }
  function choose(index: number, reset = true) {
    if (reset) stop()
    route = routes[index]
    if (reset) map.setRoute(route)
    slider.disabled = !route; play.disabled = !route?.timed; rate.disabled = !route?.timed
    get("#summary").replaceChildren()
    get("#overview").textContent = route ? `${(route.distance / 1000).toFixed(2)} km${route.duration === null ? "" : ` · ${(route.duration / 60000).toFixed(1)} min`}` : ""
    get("#playback-note").textContent = route && !route.timed ? t("ui.playbackUnavailable") : ""
    if (!route) { get("#position").textContent = t("ui.noPoints"); get("#details").textContent = ""; root.querySelectorAll(".charts svg").forEach(svg => svg.replaceChildren()); root.querySelectorAll("figcaption").forEach(caption => { caption.textContent = "" }); get("#time-note").textContent = ""; return }
    for (const [label, value] of [[t("ui.distance"), `${(route.distance / 1000).toFixed(2)} km`], [t("ui.points"), String(route.points.length)], [t("ui.segments"), String(new Set(route.points.map(p => p.segment)).size)], [t("ui.duration"), route.duration === null ? t("ui.incompleteTime") : `${(route.duration / 60000).toFixed(1)} min`]]) {
      const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label!; dd.textContent = value!; get("#summary").append(dt, dd)
    }
    slider.max = String(route.points.length - 1)
    get("#time-note").textContent = route.timed ? t("ui.timedHint") : t("ui.untimedHint")
    chart("#elevation", "elevation"); chart("#speed", "speed"); show(reset ? 0 : selected); if (reset) fit()
  }
  function tick(now: number) {
    if (!playing || !route) return
    clock += (now - lastFrame) * Number(rate.value); lastFrame = now
    show(indexAtTime(route.points, clock))
    if (clock >= route.points.at(-1)!.time!) stop(); else frame = requestAnimationFrame(tick)
  }
  async function load() {
    const token = ++generation; stop(); status.textContent = t("ui.loading")
    try {
      const bytes = await fs.readBinary(filename)
      if (disposed || ctx.signal.aborted || token !== generation) return
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      failedSource = source
      const file = parseGpx(source, undefined, t)
      cachedSource = source; failedSource = null; failure = null
      routes = file.routes; select.replaceChildren()
      routes.forEach((r, index) => { const option = document.createElement("option"); option.value = String(index); option.textContent = r.name; select.append(option) })
      select.hidden = routes.length < 2
      choose(0); status.textContent = file.warnings.join(" "); root.dataset.loaded = "true"
    } catch (error) {
      failure = error
      if (!disposed && token === generation) status.textContent = `${error instanceof Error ? error.message : String(error)}${route ? t("ui.retained") : ""}`
    }
  }
  get("#fit").addEventListener("click", fit, { signal: ctx.signal })
  get("#toggle-details").addEventListener("click", () => {
    const panel = get("#track-details"), button = get("#toggle-details")
    panel.hidden = !panel.hidden; button.setAttribute("aria-expanded", String(!panel.hidden))
  }, { signal: ctx.signal })
  get("#retry-map").addEventListener("click", () => map.retry(), { signal: ctx.signal })
  get("#reload").addEventListener("click", () => { void load() }, { signal: ctx.signal })
  select.addEventListener("change", () => choose(Number(select.value)), { signal: ctx.signal })
  slider.addEventListener("input", () => { stop(); show(Number(slider.value)) }, { signal: ctx.signal })
  play.addEventListener("click", () => {
    if (playing) { stop(); return }
    if (!route?.timed) return
    if (selected === route.points.length - 1) show(0)
    clock = route.points[selected]!.time!; lastFrame = performance.now(); playing = true; play.textContent = t("ui.pause"); frame = requestAnimationFrame(tick)
  }, { signal: ctx.signal })
  const dispose = () => { if (disposed) return; disposed = true; generation++; stop(); map.dispose(); root.replaceChildren() }
  ctx.subscriptions.add(ctx.i18n.onDidChangeLocale(() => {
    if (disposed) return
    const index = Math.max(0, routes.indexOf(route!))
    if (cachedSource) {
      const translated = parseGpx(cachedSource, undefined, t)
      routes = translated.routes
      select.querySelectorAll("option").forEach((option, i) => { option.textContent = routes[i]?.name ?? "" })
      choose(index, false)
      status.textContent = translated.warnings.join(" ")
    }
    if (failedSource) {
      try { parseGpx(failedSource, undefined, t) } catch (error) { failure = error }
    }
    if (failure) status.textContent = String(failure instanceof Error ? failure.message : failure) + (route ? t("ui.retained") : "")
    for (const [selector, key] of [
      ["#reload", "reload"], ["#fit", "fit"], ["#retry-map", "retryMap"], ["#toggle-details", "details"], ["#privacy", "privacy"],
    ]) get(selector!).textContent = t("ui." + key)
    for (const [selector, key] of [
      ["#routes", "chooseRoute"], ["#reload", "reloadLabel"], ["#fit", "fitTitle"], ["#map", "map"], [".timeline", "playback"], ["#rate", "rate"], ["#scrub", "points"], ["#elevation", "elevationChart"], ["#speed", "speedChart"],
    ]) get(selector!).setAttribute("aria-label", t("ui." + key))
    get("#reload").title = t("ui.reloadTitle")
    play.textContent = t(playing ? "ui.pause" : "ui.play")
    map.updateLocale()
  }))
  ctx.signal.addEventListener("abort", dispose, { once: true })
  await load()
  return { dispose }
}
