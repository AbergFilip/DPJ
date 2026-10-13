// Plockets regler som rena funktioner på ett lokalt tillstånd. Används av demoläget utan server,
// och av Supabase-läget när mobilen saknar nät (ändringen görs direkt i mobilen och skickas när nätet är tillbaka).
// Samma regler finns i databasfunktionerna i supabase/migrations/.
import { lineDone, type DeviationKind, type Order, type Products, type Status, type StockMove } from "./data"

export interface State { orders: Order[]; products: Products; moves: StockMove[] }

const findLine = (st: State, lineId: string, picker: string) => {
  for (const o of st.orders) {
    const l = o.lines.find(x => x.id === lineId)
    if (l) return o.status === "plock" && o.picker === picker ? { o, l } : null
  }
  return null
}

function move(st: State, sku: string, qty: number, kind: StockMove["kind"], who: string, note: string | null = null) {
  const p = st.products[sku]; if (!p) return
  p.stock = Math.max(0, p.stock + qty)
  st.moves = [{ id: `lokal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, sku, qty, kind, who, note, at: Date.now() }, ...st.moves].slice(0, 30)
}

export const ops = {
  claimMany(st: State, ids: string[], picker: string) {
    if (!ids.length || ids.length > 4 || st.orders.some(o => o.status === "plock" && o.picker === picker)) return false
    const list = ids.map(id => st.orders.find(x => x.id === id))
    if (list.some(o => !o || o.status !== "ny")) return false
    for (const o of list as Order[]) { o.status = "plock"; o.picker = picker; o.startedAt = Date.now() }
    return true
  },
  release(st: State, id: string, picker: string) {
    const o = st.orders.find(x => x.id === id)
    if (o && o.status === "plock" && o.picker === picker) { o.status = "ny"; o.picker = null; o.startedAt = null }
  },
  confirmLocation(st: State, lineId: string, picker: string) {
    const f = findLine(st, lineId, picker); if (!f) return false
    f.l.locOk = true; return true
  },
  pickItem(st: State, lineId: string, picker: string) {
    const f = findLine(st, lineId, picker)
    if (!f || !f.l.locOk || f.l.dev || f.l.picked >= f.l.qty) return null
    f.l.picked++; move(st, f.l.sku, -1, "plock", picker); return f.l.picked
  },
  reportDeviation(st: State, lineId: string, picker: string, kind: DeviationKind, found: number, note: string, photo: string | null) {
    const f = findLine(st, lineId, picker); if (!f) return false
    const n = Math.max(0, Math.min(found, f.l.qty))
    f.l.picked = n; f.l.dev = { kind, found: n, note, photo }
    if (kind !== "Skadad") move(st, f.l.sku, -(st.products[f.l.sku]?.stock ?? 0), "avvikelse", picker, kind)
    return true
  },
  finish(st: State, id: string, picker: string): Status | null {
    const o = st.orders.find(x => x.id === id)
    if (!o || o.status !== "plock" || o.picker !== picker || !o.lines.every(lineDone)) return null
    o.status = o.lines.some(l => l.dev) ? "avv" : "pack"; o.doneAt = Date.now(); return o.status
  },
  receive(st: State, sku: string, qty: number, who: string) {
    if (!st.products[sku] || qty < 1 || qty > 999) return null
    move(st, sku, qty, "in", who); return st.products[sku].stock
  },
}
