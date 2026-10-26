import mount from "../src/main"
import { testI18n } from "../test-i18n.mjs"
import type { ViewContext } from "@eidos.space/plugin-sdk"
declare global { interface Window { fixture: string; unmount: () => void; setLocale: (locale: string) => void } }
const controller = new AbortController()
const i18n = testI18n()
window.setLocale = locale => i18n.setLocale(locale)
const context = {
  i18n,
  binding: { kind: "file", file: { id: "旅行/上海/sample.gpx", path: "旅行/上海/sample.gpx", name: "上海步行 · 模拟轨迹.gpx" } },
  capabilities: { fs: { readBinary: async (path: string) => {
    if (path !== "sample.gpx") throw Error("Access outside file directory denied")
    return new TextEncoder().encode(window.fixture)
  } } },
  signal: controller.signal, subscriptions: { add() {} },
} as unknown as ViewContext
void mount(context, document.querySelector<HTMLElement>("#app")!).then(view => { window.unmount = () => { controller.abort(); view.dispose() } })
