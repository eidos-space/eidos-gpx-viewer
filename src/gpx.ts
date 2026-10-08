export interface Point {
  lat: number; lon: number; time: number | null; elevation: number | null;
  speed: number | null; measuredSpeed: boolean; distance: number; segment: number;
}
export interface Route { name: string; points: Point[]; distance: number; timed: boolean; duration: number | null }
export interface GpxFile { routes: Route[]; warnings: string[] }
const namespaces = new Set(["http://www.topografix.com/GPX/1/1", "http://www.topografix.com/GPX/1/0", ""])
const children = (el: Element, name: string): Element[] => Array.from(el.childNodes)
  .filter((node): node is Element => node.nodeType === 1)
  .filter(node => node.localName === name && node.namespaceURI === el.namespaceURI)
const text = (el: Element, name: string) => children(el, name)[0]?.textContent?.trim() ?? ""
const number = (value: string | null): number | null => {
  if (!value?.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null
  const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null
}
export function distance(a: {lat: number; lon: number}, b: {lat: number; lon: number}): number {
  const rad = Math.PI / 180
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)))
}
export function parseGpx(source: string, parser: Pick<DOMParser, "parseFromString"> = new DOMParser()): GpxFile {
  if (source.length > 16 * 1024 * 1024) throw Error("GPX 超过 16 MiB，需拆分后打开。")
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(source)) throw Error("不支持包含 DTD 或实体声明的 GPX。")
  const doc = parser.parseFromString(source, "application/xml")
  const root = doc.documentElement
  if (!root || doc.getElementsByTagName("parsererror").length || root.localName !== "gpx" || !namespaces.has(root.namespaceURI ?? "")) throw Error("文件不是有效的 GPX 1.0 / 1.1 XML。")
  const version = root.getAttribute("version")
  if (version && version !== "1.0" && version !== "1.1") throw Error(`不支持 GPX ${version}。`)
  const warnings: string[] = [], routes: Route[] = []
  let skipped = 0, count = 0, sequence = 0
  function route(name: string, groups: Element[][]) {
    const points: Point[] = []; let total = 0, segment = 0
    for (const group of groups) {
      segment++
      let previous: Point | undefined
      for (const node of group) {
        if (++count > 100000) throw Error("超过 100,000 个轨迹点，需拆分后打开。")
        const lat = number(node.getAttribute("lat")), lon = number(node.getAttribute("lon"))
        if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) { skipped++; previous = undefined; segment++; continue }
        const timeText = text(node, "time")
        const parsedTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timeText) ? Date.parse(timeText) : NaN
        const time = Number.isFinite(parsedTime) ? parsedTime : null
        const ext = children(node, "extensions")[0]
        const measured = ext?.getElementsByTagNameNS("urn:waylog:gpx:1", "speedMetersPerSecond")[0]?.textContent
        const rawSpeed = number(measured ?? (version === "1.0" ? text(node, "speed") : ""))
        const point: Point = { lat, lon, time, elevation: number(text(node, "ele")), speed: rawSpeed !== null && rawSpeed >= 0 ? rawSpeed : null, measuredSpeed: rawSpeed !== null && rawSpeed >= 0, distance: total, segment }
        if (previous) {
          const meters = distance(previous, point); total += meters; point.distance = total
          if (point.speed === null && previous.time !== null && time !== null && time > previous.time) point.speed = meters / ((time - previous.time) / 1000)
        }
        points.push(point); previous = point
      }
    }
    if (!points.length) return
    const timed = points.length > 1 && points.every((p, i) => p.time !== null && (i === 0 || p.time > points[i - 1]!.time!))
    routes.push({ name, points, distance: total, timed, duration: timed ? points.at(-1)!.time! - points[0]!.time! : null })
  }
  for (const track of children(root, "trk")) route(text(track, "name") || `轨迹 ${++sequence}`, children(track, "trkseg").map(seg => children(seg, "trkpt")))
  for (const path of children(root, "rte")) route(text(path, "name") || `路线 ${++sequence}`, [children(path, "rtept")])
  const waypoints = children(root, "wpt")
  if (waypoints.length) route("航点", waypoints.map(p => [p]))
  if (skipped) warnings.push(`已跳过 ${skipped} 个无效坐标；断点两侧不会连线。`)
  if (!routes.length) warnings.push("文件中没有可显示的轨迹、路线或航点。")
  if (!root.namespaceURI) warnings.push("此文件未声明 GPX 命名空间，已兼容读取。")
  return { routes, warnings }
}
export function indexAtTime(points: Point[], time: number): number {
  let low = 0, high = points.length - 1
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (points[middle]!.time! <= time) low = middle; else high = middle - 1 }
  return low
}
export function mapLines(points: Point[]): [number, number][][] {
  const lines: [number, number][][] = []; let current: [number, number][] = []
  points.forEach((p, i) => {
    if (i && (p.segment !== points[i - 1]!.segment || Math.abs(p.lon - points[i - 1]!.lon) > 180)) { lines.push(current); current = [] }
    current.push([p.lat, p.lon])
  }); if (current.length) lines.push(current)
  return lines
}
