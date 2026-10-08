import type { ViewContext } from "@eidos.space/plugin-sdk"
import { RouteMap } from "./map"
import "./style.css"
import { parseGpx, indexAtTime, type Route } from "./gpx"

export default async function mount(ctx: ViewContext, root: HTMLElement) {
  if (ctx.binding.kind !== "file" || !ctx.capabilities.fs) throw Error("需要绑定一个 GPX 文件。")
  const fs = ctx.capabilities.fs, path = ctx.binding.file.path ?? ctx.binding.file.id
  // Bound-file fs paths are relative to the bound file's directory, while
  // binding.file.path describes its location relative to the Space root.
  const filename = path.split("/").at(-1)!
  root.classList.add("gpx-viewer")
  root.innerHTML = `<header><div class="identity"><span id="filename"></span><span id="overview"></span></div><select id="routes" aria-label="选择轨迹" hidden></select><button id="reload" aria-label="重新读取" title="重新读取文件">刷新</button><button id="fit" aria-label="显示全程">全程</button></header>
    <div class="message" role="status" aria-live="polite">正在读取轨迹…</div>
    <div class="map-notice"><span id="map-status" role="status"></span><button id="retry-map">重试底图</button></div>
    <div id="map" role="region" aria-label="轨迹地图"></div>
    <section class="timeline" aria-label="轨迹播放"><div class="controls"><button id="play" disabled>播放</button><select id="rate" aria-label="播放速度"><option value="1">1×</option><option value="10">10×</option><option value="60" selected>60×</option><option value="300">300×</option></select><input id="scrub" type="range" min="0" max="0" value="0" aria-label="轨迹点" disabled><span id="position">尚未选择轨迹</span><button id="toggle-details" aria-expanded="false" aria-controls="track-details">详情</button></div>
    <div id="track-details" hidden><dl id="summary"></dl><p id="details"></p><div class="charts"><figure><figcaption>海拔 · m</figcaption><svg id="elevation" viewBox="0 0 600 90" role="img" aria-label="海拔曲线"></svg></figure><figure><figcaption>速度 · km/h</figcaption><svg id="speed" viewBox="0 0 600 90" role="img" aria-label="速度曲线"></svg></figure></div><p class="hint" id="time-note"></p><p class="hint">GPX 文件保留在本机。底图需要联网。</p></div><p id="playback-note" class="hint"></p></section>`
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  get("#filename").textContent = ctx.binding.file.name ?? path
  get("#filename").title = ctx.binding.file.name ?? path
  const status = get(".message"), select = get<HTMLSelectElement>("#routes"), slider = get<HTMLInputElement>("#scrub"), play = get<HTMLButtonElement>("#play"), rate = get<HTMLSelectElement>("#rate")
  const map = new RouteMap(get("#map"), get("#map-status"))
  let routes: Route[] = [], route: Route | undefined, selected = 0, frame = 0, disposed = false, generation = 0
  let playing = false, clock = 0, lastFrame = 0
  const format = (n: number | null, suffix: string) => n === null ? "未记录" : `${n.toFixed(1)} ${suffix}`
  function stop() { playing = false; cancelAnimationFrame(frame); play.textContent = "播放" }
  function fit() { map.fit() }
  function chart(id: string, key: "elevation" | "speed") {
    const svg = root.querySelector<SVGSVGElement>(id)!; svg.replaceChildren()
    const element = (name: string, attrs: Record<string, string>) => { const node = document.createElementNS("http://www.w3.org/2000/svg", name); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); svg.append(node); return node }
    const values = route!.points.map(p => p[key] === null ? null : p[key]! * (key === "speed" ? 3.6 : 1))
    let min = Infinity, max = -Infinity
    for (const value of values) if (value !== null) { min = Math.min(min, value); max = Math.max(max, value) }
    const caption = svg.previousElementSibling!
    caption.textContent = `${key === "speed" ? "速度 · km/h" : "海拔 · m"} · ${Number.isFinite(min) ? `${min.toFixed(2)} — ${max.toFixed(2)}` : "文件未记录此项"}`
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
    get("#position").textContent = `${selected + 1} / ${route.points.length}${p.time === null ? "" : ` · ${new Date(p.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}`}`
    get("#details").textContent = `${p.time === null ? "未记录时间" : new Date(p.time).toLocaleString()} · ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)} · ${(p.distance / 1000).toFixed(2)} km · 海拔 ${format(p.elevation, "m")} · ${p.measuredSpeed ? "记录速度" : "推算速度"} ${format(p.speed === null ? null : p.speed * 3.6, "km/h")}`
    const x = String(8 + 584 * selected / Math.max(1, route.points.length - 1))
    root.querySelectorAll(".chart-cursor").forEach(line => { line.setAttribute("x1", x); line.setAttribute("x2", x) })
  }
  function choose(index: number) {
    stop(); route = routes[index]; map.setRoute(route)
    slider.disabled = !route; play.disabled = !route?.timed; rate.disabled = !route?.timed
    get("#summary").replaceChildren()
    get("#overview").textContent = route ? `${(route.distance / 1000).toFixed(2)} km${route.duration === null ? "" : ` · ${(route.duration / 60000).toFixed(1)} min`}` : ""
    get("#playback-note").textContent = route && !route.timed ? "时间不完整，无法播放；可拖动查看轨迹点。" : ""
    if (!route) { get("#position").textContent = "没有可显示的轨迹点"; get("#details").textContent = ""; root.querySelectorAll(".charts svg").forEach(svg => svg.replaceChildren()); root.querySelectorAll("figcaption").forEach(caption => { caption.textContent = "" }); get("#time-note").textContent = ""; return }
    for (const [label, value] of [["距离", `${(route.distance / 1000).toFixed(2)} km`], ["轨迹点", String(route.points.length)], ["分段", String(new Set(route.points.map(p => p.segment)).size)], ["总时长", route.duration === null ? "时间不完整" : `${(route.duration / 60000).toFixed(1)} min`]]) {
      const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label!; dd.textContent = value!; get("#summary").append(dt, dd)
    }
    slider.max = String(route.points.length - 1)
    get("#time-note").textContent = route.timed ? "按原始时间播放，分段间保留时间空档。曲线横轴为轨迹点；速度缺失时按相邻点推算。" : "时间缺失、重复或逆序：可拖动查看各点，时间播放不可用。曲线横轴为轨迹点。"
    chart("#elevation", "elevation"); chart("#speed", "speed"); show(0); fit()
  }
  function tick(now: number) {
    if (!playing || !route) return
    clock += (now - lastFrame) * Number(rate.value); lastFrame = now
    show(indexAtTime(route.points, clock))
    if (clock >= route.points.at(-1)!.time!) stop(); else frame = requestAnimationFrame(tick)
  }
  async function load() {
    const token = ++generation; stop(); status.textContent = "正在读取轨迹…"
    try {
      const bytes = await fs.readBinary(filename)
      if (disposed || ctx.signal.aborted || token !== generation) return
      const file = parseGpx(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
      routes = file.routes; select.replaceChildren()
      routes.forEach((r, index) => { const option = document.createElement("option"); option.value = String(index); option.textContent = r.name; select.append(option) })
      select.hidden = routes.length < 2
      choose(0); status.textContent = file.warnings.join(" "); root.dataset.loaded = "true"
    } catch (error) {
      if (!disposed && token === generation) status.textContent = `${error instanceof Error ? error.message : String(error)}${route ? " 当前仍显示上次成功读取的内容。" : ""}`
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
    clock = route.points[selected]!.time!; lastFrame = performance.now(); playing = true; play.textContent = "暂停"; frame = requestAnimationFrame(tick)
  }, { signal: ctx.signal })
  const dispose = () => { if (disposed) return; disposed = true; generation++; stop(); map.dispose(); root.replaceChildren() }
  ctx.signal.addEventListener("abort", dispose, { once: true })
  await load()
  return { dispose }
}
