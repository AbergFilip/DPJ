// Statistik över tid för översikten.
// Dagens siffror räknas från riktiga rörelser och order i demon. Timmar och veckor som redan passerat
// fylls med en påhittad historik, eftersom demon inte har någon äldre data. Historiken är alltid
// densamma för samma dag, så siffrorna inte hoppar mellan sidladdningar.
import type { Order, StockMove } from "./data"

const WEEKS = 8
export const DAY_START = 7
export const DAY_END = 17

// Enkel slumpgenerator med frö, så demohistoriken ser likadan ut varje gång.
function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}
const dayKey = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()

export interface HourBar { hour: number; picks: number; demo: boolean }
export interface WeekBar { label: string; orders: number; devs: number; rate: number; demo: boolean }

// Plock per timme i dag. Timmar före den aktuella timmen får demohistorik när inget plockats.
export function picksPerHour(moves: StockMove[], now = Date.now()): HourBar[] {
  const d = new Date(now)
  const real = new Array(24).fill(0) as number[]
  for (const m of moves) {
    if (m.kind !== "plock") continue
    const t = new Date(m.at)
    if (dayKey(t) === dayKey(d)) real[t.getHours()] += Math.abs(m.qty)
  }
  const r = rng(dayKey(d))
  const bars: HourBar[] = []
  for (let h = DAY_START; h <= DAY_END; h++) {
    if (real[h] > 0) { bars.push({ hour: h, picks: real[h], demo: false }); continue }
    const passed = h < d.getHours()
    // Lugnare runt lunch, mest på förmiddagen.
    const base = h === 12 ? 9 : h <= 9 ? 26 : h <= 14 ? 22 : 16
    bars.push({ hour: h, picks: passed ? Math.round(base * (0.7 + r() * 0.6)) : 0, demo: passed })
  }
  return bars
}

// Felrate per vecka: andel plockade order med avvikelse. Den här veckan räknas från demons egna order.
export function errorsPerWeek(orders: Order[], now = Date.now()): WeekBar[] {
  const done = orders.filter(o => o.status === "pack" || o.status === "avv" || o.status === "skickad")
  const devs = done.filter(o => o.lines.some(l => l.dev)).length
  const r = rng(dayKey(new Date(now)) + 7)
  const weeks: WeekBar[] = []
  for (let k = WEEKS - 1; k >= 1; k--) {
    const n = Math.round(60 + r() * 50)
    // Felraten sjunker svagt mot nutid, som när ett nytt arbetssätt sätter sig.
    const rate = Math.max(0.5, 5.5 - (WEEKS - k) * 0.35 + (r() - 0.5) * 1.6)
    weeks.push({ label: `v ${weekNo(now, k)}`, orders: n, devs: Math.round(n * rate / 100), rate: Math.round(rate * 10) / 10, demo: true })
  }
  // Den här veckan: demons egna plockade order ovanpå en påhittad vecka som redan börjat,
  // annars skulle två order ge en felrate på 50 procent.
  const baseN = Math.round(30 + r() * 25), baseDev = Math.round(baseN * (2.5 + r()) / 100)
  const n = baseN + done.length, d = baseDev + devs
  weeks.push({ label: `v ${weekNo(now, 0)}`, orders: n, devs: d, rate: Math.round((d / n) * 1000) / 10, demo: false })
  return weeks
}

// ISO-veckonummer, k veckor bakåt.
export function weekNo(now: number, back: number) {
  const d = new Date(now - back * 7 * 86400000)
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)
}
