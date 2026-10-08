import mount from "../src/main"
import type { ViewContext } from "@eidos.space/plugin-sdk"
declare global { interface Window { fixture: string; unmount: () => void } }
const controller = new AbortController()
const context = {
  binding: { kind: "file", file: { id: "旅行/上海/sample.gpx", path: "旅行/上海/sample.gpx", name: "上海步行 · 模拟轨迹.gpx" } },
  capabilities: { fs: { readBinary: async (path: string) => {
    if (path !== "sample.gpx") throw Error("Access outside file directory denied")
    return new TextEncoder().encode(window.fixture)
  } } },
  signal: controller.signal, subscriptions: { add() {} },
} as unknown as ViewContext
void mount(context, document.querySelector<HTMLElement>("#app")!).then(view => { window.unmount = () => { controller.abort(); view.dispose() } })
