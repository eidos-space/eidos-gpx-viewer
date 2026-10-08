import { Map, Marker, NavigationControl, LngLatBounds, setWorkerUrl, setWorkerCount } from './map-runtime.js'
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import worker from './map-worker.json'
import basemap from './basemap.json'
import { mapLines, type Route, type Point } from './gpx'

/** A native-resolution vector map, with route overlays independent of tile loading. */
export class RouteMap {
  private map: Map | null = null
  private route?: Route
  private markers: Marker[] = []
  private cursor?: Marker
  private ready = false
  private observer: ResizeObserver
  private workerUrl: string
  private disposed = false
  constructor(private container: HTMLElement, private status: HTMLElement) {
    this.workerUrl = URL.createObjectURL(new Blob([worker], { type: 'text/javascript' }))
    setWorkerUrl(this.workerUrl); setWorkerCount(2)
    this.observer = new ResizeObserver(() => this.map?.resize())
    try {
      this.map = new Map({ container, style: this.style(), center: [10, 25], zoom: 2, maxZoom: 20,
        dragRotate: false, pitchWithRotate: false, touchPitch: false, attributionControl: { compact: false } })
      this.map.touchZoomRotate.disableRotation()
      this.map.addControl(new NavigationControl({ showCompass: false }), 'top-left')
      this.map.on('style.load', () => { this.ready = true; this.render() })
      this.map.on('error', () => {
        if (!this.disposed) status.textContent = '底图加载失败；轨迹仍可查看。联网后点击“重试底图”。'
      })
      this.map.on('idle', () => { container.dataset.mapReady = 'true' })
      this.observer.observe(container)
    } catch {
      status.textContent = '地图需要 WebGL。请检查 Eidos 的硬件加速设置；仍可查看轨迹统计与时间轴。'
    }
  }
  private style(): StyleSpecification { return structuredClone(basemap) as unknown as StyleSpecification }
  private dot(color: string, title: string): Marker {
    const element = document.createElement('span')
    element.className = 'route-marker'; element.style.backgroundColor = color
    element.setAttribute('role', 'img'); element.setAttribute('aria-label', title); element.title = title
    return new Marker({ element })
  }
  setRoute(route?: Route) {
    this.route = route
    this.markers.forEach(m => m.remove()); this.markers = []; this.cursor?.remove(); this.cursor = undefined
    if (this.map && route) {
      const first = route.points[0]!, last = route.points.at(-1)!
      this.markers = [this.dot('#278061', '起点').setLngLat([first.lon, first.lat]).addTo(this.map),
        this.dot('#bc652d', '终点').setLngLat([last.lon, last.lat]).addTo(this.map)]
    }
    this.render(); this.fit()
  }
  show(point: Point) {
    if (!this.map) return
    this.cursor ??= this.dot('#2563eb', '当前轨迹点').setLngLat([point.lon, point.lat]).addTo(this.map)
    this.cursor.setLngLat([point.lon, point.lat])
  }
  private render() {
    const map = this.map
    if (!map || !this.ready) return
    const features = mapLines(this.route?.points ?? []).map(line => ({ type: 'Feature' as const, properties: {},
      geometry: line.length === 1 ? { type: 'Point' as const, coordinates: [line[0]![1], line[0]![0]] }
        : { type: 'LineString' as const, coordinates: line.map(([lat, lon]) => [lon, lat]) } }))
    const data = { type: 'FeatureCollection' as const, features }
    const source = map.getSource<GeoJSONSource>('gpx-route')
    if (source) source.setData(data)
    else {
      map.addSource('gpx-route', { type: 'geojson', data })
      map.addLayer({ id: 'gpx-casing', type: 'line', source: 'gpx-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 7 } })
      map.addLayer({ id: 'gpx-line', type: 'line', source: 'gpx-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#278061', 'line-width': 4 } })
      map.addLayer({ id: 'gpx-points', type: 'circle', source: 'gpx-route', filter: ['==', '$type', 'Point'], paint: { 'circle-color': '#278061', 'circle-radius': 4, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
    }
  }
  fit() {
    if (!this.map || !this.route) return
    const bounds = new LngLatBounds()
    this.route.points.forEach(p => bounds.extend([p.lon, p.lat]))
    this.map.fitBounds(bounds, { padding: 30, maxZoom: 17, duration: 0 })
  }
  retry() {
    if (!this.map) return
    this.status.textContent = ''; delete this.container.dataset.mapReady; this.ready = false
    this.map.setStyle(this.style(), { diff: false })
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true; this.observer.disconnect(); this.markers.forEach(m => m.remove()); this.cursor?.remove()
    this.map?.remove(); URL.revokeObjectURL(this.workerUrl)
  }
}
