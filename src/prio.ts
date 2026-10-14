// Prioritering när saldot inte räcker, och förslag på vad som ska inventeras först.
// Allt räknas fram ur orderkön och saldot, så samma regler gäller i plockappen, översikten och simuleringen.
import type { Order, Products, StockMove } from "./data"

export interface Short { sku: string; missing: number }
export interface Alloc { rank: number; ok: boolean; short: Short[] }

// Ordning när varorna inte räcker till alla: order som redan plockas först, sedan express,
// sedan den som ska vara klar tidigast och sist den äldsta ordern.
const prio = (o: Order) => (o.status === "plock" ? 0 : 1) * 1e6 + (o.ship === "exp" ? 0 : 1) * 1e5 + Number(o.due.replace(":", "")) * 10
export const byPrio = (a: Order, b: Order) => prio(a) - prio(b) || a.id.localeCompare(b.id, "sv", { numeric: true })

// Fördelar hyllsaldot på orderna i kön. En order som kan plockas komplett får sina varor reserverade.
// En order som inte kan det blir restorder och reserverar ingenting, så varorna går till order
// som kan skickas hela i stället. Order som redan plockas behåller alltid det de har.
export function allocate(orders: Order[], products: Products): Map<string, Alloc> {
  const left: Record<string, number> = {}
  for (const p of Object.values(products)) left[p.sku] = Math.max(0, p.stock)
  const res = new Map<string, Alloc>()
  const open = orders.filter(o => o.status === "ny" || o.status === "plock").sort(byPrio)
  open.forEach((o, i) => {
    const need = o.lines.filter(l => !l.dev).map(l => ({ sku: l.sku, n: l.qty - l.picked }))
    const short = need.filter(x => x.n > (left[x.sku] ?? 0)).map(x => ({ sku: x.sku, missing: x.n - (left[x.sku] ?? 0) }))
    if (!short.length || o.status === "plock") for (const x of need) left[x.sku] = Math.max(0, (left[x.sku] ?? 0) - x.n)
    res.set(o.id, { rank: i + 1, ok: !short.length, short })
  })
  return res
}

// Sortering för kön: kompletta order först i prioritetsordning, restorder sist.
export function queueOrder(orders: Order[], alloc: Map<string, Alloc>) {
  return [...orders].sort((a, b) => {
    const x = alloc.get(a.id), y = alloc.get(b.id)
    return Number(!(x?.ok ?? true)) - Number(!(y?.ok ?? true)) || (x?.rank ?? 1e9) - (y?.rank ?? 1e9)
  })
}

export type CountReason = "dev" | "short" | "empty" | "busy" | "never" | "old"
export interface CountTip { sku: string; reason: CountReason; score: number; picks: number }

const DAY = 86400000
// Hyllor som borde räknas, viktigast först. Avvikelser och saldon som inte räcker väger tyngst,
// sedan hyllor där det plockats mycket sedan senaste räkningen och hyllor som aldrig räknats.
export function countTips(products: Products, orders: Order[], moves: StockMove[], now = Date.now()): CountTip[] {
  const alloc = allocate(orders, products)
  const shortSkus = new Set([...alloc.values()].flatMap(a => a.short.map(s => s.sku)))
  const tips: CountTip[] = []
  for (const p of Object.values(products)) {
    const since = p.countedAt ?? 0
    const after = moves.filter(m => m.sku === p.sku && m.at > since)
    const devs = after.filter(m => m.kind === "avvikelse").length
    const picks = after.filter(m => m.kind === "plock").reduce((n, m) => n + Math.abs(m.qty), 0)
    const age = p.countedAt ? (now - p.countedAt) / DAY : Infinity
    let reason: CountReason | null = null, score = 0
    if (devs) { reason = "dev"; score = 100 + devs * 10 }
    else if (shortSkus.has(p.sku)) { reason = "short"; score = 80 }
    else if (p.stock <= 0) { reason = "empty"; score = 60 }
    else if (picks >= 8) { reason = "busy"; score = 40 + picks }
    else if (!p.countedAt) { reason = "never"; score = 20 }
    else if (age > 30) { reason = "old"; score = 10 + Math.min(age, 90) / 10 }
    if (reason) tips.push({ sku: p.sku, reason, score, picks })
  }
  return tips.sort((a, b) => b.score - a.score)
}
