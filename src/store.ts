// Datalager. Supabase när det är konfigurerat (delad kö, live för alla mobiler), annars lokalt i webbläsaren.
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  SEED_PRODUCTS, lineDone, seedOrders,
  type DeviationKind, type Order, type Products, type Product, type Snapshot, type Status,
} from "./data"
import type { NewOrder } from "./csv"

export interface Store {
  mode: "supabase" | "local"
  subscribe(cb: (s: Snapshot) => void, onError?: (msg: string) => void): () => void
  claim(orderId: string, picker: string): Promise<boolean>
  release(orderId: string, picker: string): Promise<void>
  confirmLocation(lineId: string, picker: string): Promise<boolean>
  pickItem(lineId: string, picker: string): Promise<number | null>
  reportDeviation(lineId: string, picker: string, kind: DeviationKind, found: number, note: string, photo: Blob | null): Promise<boolean>
  finish(orderId: string, picker: string): Promise<Status | null>
  importOrders(orders: NewOrder[]): Promise<number>
  reset(): Promise<void>
}

/* ---------- Lokalt (demo utan server) ---------- */

const KEY = "dpj-plock-local-v3"

function localStore(): Store {
  let orders: Order[]
  try { orders = JSON.parse(localStorage.getItem(KEY) || "null") } catch { orders = null as unknown as Order[] }
  if (!Array.isArray(orders)) orders = seedOrders()
  const subs = new Set<(s: Snapshot) => void>()
  const emit = () => {
    try { localStorage.setItem(KEY, JSON.stringify(orders)) } catch { /* privat läge */ }
    const snap = { products: SEED_PRODUCTS, orders: structuredClone(orders) }
    subs.forEach(cb => cb(snap))
  }
  const findLine = (lineId: string, picker: string) => {
    for (const o of orders) {
      const l = o.lines.find(x => x.id === lineId)
      if (l) return o.status === "plock" && o.picker === picker ? { o, l } : null
    }
    return null
  }
  const toDataUrl = (b: Blob) => new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(b) })
  return {
    mode: "local",
    subscribe(cb) { subs.add(cb); cb({ products: SEED_PRODUCTS, orders: structuredClone(orders) }); return () => { subs.delete(cb) } },
    async claim(id, picker) {
      if (orders.some(o => o.status === "plock" && o.picker === picker)) return false
      const o = orders.find(x => x.id === id)
      if (!o || o.status !== "ny") return false
      o.status = "plock"; o.picker = picker; o.startedAt = Date.now(); emit(); return true
    },
    async release(id, picker) {
      const o = orders.find(x => x.id === id)
      if (o && o.status === "plock" && o.picker === picker) { o.status = "ny"; o.picker = null; o.startedAt = null; emit() }
    },
    async confirmLocation(lineId, picker) {
      const f = findLine(lineId, picker); if (!f) return false
      f.l.locOk = true; emit(); return true
    },
    async pickItem(lineId, picker) {
      const f = findLine(lineId, picker)
      if (!f || !f.l.locOk || f.l.dev || f.l.picked >= f.l.qty) return null
      f.l.picked++; emit(); return f.l.picked
    },
    async reportDeviation(lineId, picker, kind, found, note, photo) {
      const f = findLine(lineId, picker); if (!f) return false
      const n = Math.max(0, Math.min(found, f.l.qty))
      f.l.picked = n; f.l.dev = { kind, found: n, note, photo: photo ? await toDataUrl(photo) : null }; emit(); return true
    },
    async finish(id, picker) {
      const o = orders.find(x => x.id === id)
      if (!o || o.status !== "plock" || o.picker !== picker || !o.lines.every(lineDone)) return null
      o.status = o.lines.some(l => l.dev) ? "avv" : "pack"; o.doneAt = Date.now(); emit(); return o.status
    },
    async importOrders(list) {
      const fresh = list.filter(n => !orders.some(o => o.id === n.id))
      orders.push(...fresh.map(n => ({
        id: n.id, cust: n.cust, ship: n.ship, shipTxt: n.shipTxt, due: n.due, status: "ny" as const,
        lines: n.lines.map(l => ({ id: `${n.id}-${l.sku}`, sku: l.sku, qty: l.qty, picked: 0, locOk: false, dev: null })),
      })))
      emit(); return fresh.length
    },
    async reset() { orders = seedOrders(); emit() },
  }
}

/* ---------- Supabase ---------- */

interface OrderRow { id: string; cust: string; ship: "exp" | "std"; ship_txt: string; due: string; status: Status; picker: string | null; started_at: string | null; done_at: string | null }
interface LineRow { id: number; order_id: string; sku: string; qty: number; picked: number; loc_ok: boolean; dev_kind: DeviationKind | null; dev_found: number | null; dev_note: string | null; dev_photo_url: string | null }

function supabaseStore(sb: SupabaseClient): Store {
  const subs = new Set<(s: Snapshot) => void>()
  const errs = new Set<(m: string) => void>()
  let products: Products = {}
  let channel: ReturnType<SupabaseClient["channel"]> | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const ts = (s: string | null) => (s ? Date.parse(s) : null)
  async function load() {
    const [p, o, l] = await Promise.all([
      Object.keys(products).length ? Promise.resolve({ data: null, error: null }) : sb.from("products").select("*"),
      sb.from("orders").select("*"),
      sb.from("order_lines").select("*").order("id"),
    ])
    const err = p.error || o.error || l.error
    if (err) { errs.forEach(cb => cb(err.message)); return }
    if (p.data) products = Object.fromEntries((p.data as Product[]).map(x => [x.sku, x]))
    const byOrder = new Map<string, LineRow[]>()
    for (const r of l.data as LineRow[]) byOrder.set(r.order_id, [...(byOrder.get(r.order_id) || []), r])
    const orders: Order[] = (o.data as OrderRow[]).map(r => ({
      id: r.id, cust: r.cust, ship: r.ship, shipTxt: r.ship_txt, due: r.due, status: r.status,
      picker: r.picker, startedAt: ts(r.started_at), doneAt: ts(r.done_at),
      lines: (byOrder.get(r.id) || []).map(x => ({
        id: String(x.id), sku: x.sku, qty: x.qty, picked: x.picked, locOk: x.loc_ok,
        dev: x.dev_kind ? { kind: x.dev_kind, found: x.dev_found ?? 0, note: x.dev_note ?? "", photo: x.dev_photo_url } : null,
      })),
    }))
    const snap = { products, orders }
    subs.forEach(cb => cb(snap))
  }
  const refresh = () => { clearTimeout(timer); timer = setTimeout(load, 120) }

  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await sb.rpc(fn, args)
    if (error) { errs.forEach(cb => cb(error.message)); throw error }
    await load()
    return data as T
  }

  return {
    mode: "supabase",
    subscribe(cb, onError) {
      subs.add(cb); if (onError) errs.add(onError)
      if (!channel) {
        channel = sb.channel("plock")
          .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, refresh)
          .on("postgres_changes", { event: "*", schema: "public", table: "order_lines" }, refresh)
          .subscribe()
      }
      load()
      return () => { subs.delete(cb); if (onError) errs.delete(onError) }
    },
    claim: (id, picker) => rpc<boolean>("claim_order", { p_order: id, p_picker: picker }),
    release: (id, picker) => rpc<void>("release_order", { p_order: id, p_picker: picker }),
    confirmLocation: (lineId, picker) => rpc<boolean>("confirm_location", { p_line: Number(lineId), p_picker: picker }),
    pickItem: (lineId, picker) => rpc<number | null>("pick_item", { p_line: Number(lineId), p_picker: picker }),
    async reportDeviation(lineId, picker, kind, found, note, photo) {
      let url: string | null = null
      if (photo) {
        const path = `${lineId}/${Date.now()}.jpg`
        const up = await sb.storage.from("avvikelser").upload(path, photo, { contentType: "image/jpeg" })
        if (!up.error) url = sb.storage.from("avvikelser").getPublicUrl(path).data.publicUrl
      }
      return rpc<boolean>("report_deviation", { p_line: Number(lineId), p_picker: picker, p_kind: kind, p_found: found, p_note: note, p_photo_url: url })
    },
    finish: (id, picker) => rpc<Status | null>("finish_order", { p_order: id, p_picker: picker }),
    importOrders: list => rpc<number>("import_orders", {
      p_orders: list.map(o => ({ id: o.id, cust: o.cust, ship: o.ship, ship_txt: o.shipTxt, due: o.due, lines: o.lines })),
    }),
    reset: () => rpc<void>("reset_demo", {}),
  }
}

export function createStore(): Store {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined
  if (import.meta.env.VITE_STORE === "local" || !url || !key) return localStore()
  return supabaseStore(createClient(url, key))
}
