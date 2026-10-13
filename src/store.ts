// Datalager. Supabase när det är konfigurerat (delad kö, live för alla mobiler), annars lokalt i webbläsaren.
// Utan nät fortsätter Supabase-läget mot en kopia i mobilen och skickar ändringarna i ordning när nätet är tillbaka.
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  SEED_PRODUCTS, seedOrders,
  type DeviationKind, type Order, type Product, type Snapshot, type Status, type StockMove,
} from "./data"
import type { NewOrder } from "./csv"
import { ops, type State } from "./ops"

export interface SyncStatus { online: boolean; pending: number }

export interface Store {
  mode: "supabase" | "local"
  subscribe(cb: (s: Snapshot) => void, onError?: (msg: string) => void): () => void
  onStatus(cb: (s: SyncStatus) => void): () => void
  claimMany(orderIds: string[], picker: string): Promise<boolean>
  release(orderId: string, picker: string): Promise<void>
  confirmLocation(lineId: string, picker: string): Promise<boolean>
  pickItem(lineId: string, picker: string): Promise<number | null>
  reportDeviation(lineId: string, picker: string, kind: DeviationKind, found: number, note: string, photo: Blob | null): Promise<boolean>
  finish(orderId: string, picker: string): Promise<Status | null>
  pack(orderId: string, packer: string, weight: number): Promise<boolean>
  importOrders(orders: NewOrder[]): Promise<number>
  receive(sku: string, qty: number, who: string): Promise<number | null>
  reset(): Promise<void>
}

const toDataUrl = (b: Blob) => new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(b) })
const read = <T,>(key: string): T | null => { try { return JSON.parse(localStorage.getItem(key) || "null") } catch { return null } }
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* fullt eller privat läge */ } }

/* ---------- Lokalt (demo utan server) ---------- */

const KEY = "dpj-plock-local-v3"
const STOCK_KEY = "dpj-plock-local-stock-v1"
const seedStock = () => ({ products: structuredClone(SEED_PRODUCTS), moves: [] as StockMove[] })

function localStore(): Store {
  const load = (): State => {
    const orders = read<Order[]>(KEY)
    const stock = read<ReturnType<typeof seedStock>>(STOCK_KEY)
    const s = stock?.products ? stock : seedStock()
    return { orders: Array.isArray(orders) ? orders : seedOrders(), products: s.products, moves: s.moves }
  }
  let st = load()
  const subs = new Set<(s: Snapshot) => void>()
  const snapshot = (): Snapshot => structuredClone(st)
  const emit = () => {
    write(KEY, st.orders); write(STOCK_KEY, { products: st.products, moves: st.moves })
    const snap = snapshot()
    subs.forEach(cb => cb(snap))
  }
  // Andra flikar i samma webbläsare (till exempel översikten) ser ändringarna direkt.
  window.addEventListener("storage", e => {
    if (e.key !== KEY && e.key !== STOCK_KEY) return
    st = load(); const snap = snapshot(); subs.forEach(cb => cb(snap))
  })
  const run = <T,>(fn: () => T) => { const r = fn(); emit(); return r }
  return {
    mode: "local",
    subscribe(cb) { subs.add(cb); cb(snapshot()); return () => { subs.delete(cb) } },
    onStatus(cb) { cb({ online: true, pending: 0 }); return () => {} },
    claimMany: async (ids, picker) => run(() => ops.claimMany(st, ids, picker)),
    release: async (id, picker) => run(() => ops.release(st, id, picker)),
    confirmLocation: async (lineId, picker) => run(() => ops.confirmLocation(st, lineId, picker)),
    pickItem: async (lineId, picker) => run(() => ops.pickItem(st, lineId, picker)),
    async reportDeviation(lineId, picker, kind, found, note, photo) {
      const url = photo ? await toDataUrl(photo) : null
      return run(() => ops.reportDeviation(st, lineId, picker, kind, found, note, url))
    },
    finish: async (id, picker) => run(() => ops.finish(st, id, picker)),
    pack: async (id, packer, weight) => run(() => ops.pack(st, id, packer, weight)),
    async importOrders(list) {
      const fresh = list.filter(n => !st.orders.some(o => o.id === n.id))
      st.orders.push(...fresh.map(n => ({
        id: n.id, cust: n.cust, ship: n.ship, shipTxt: n.shipTxt, due: n.due, status: "ny" as const,
        lines: n.lines.map(l => ({ id: `${n.id}-${l.sku}`, sku: l.sku, qty: l.qty, picked: 0, locOk: false, dev: null })),
      })))
      emit(); return fresh.length
    },
    receive: async (sku, qty, who) => run(() => ops.receive(st, sku, qty, who)),
    async reset() { st = { orders: seedOrders(), ...seedStock() }; emit() },
  }
}

/* ---------- Supabase ---------- */

interface OrderRow {
  id: string; cust: string; ship: "exp" | "std"; ship_txt: string; due: string; status: Status; picker: string | null; started_at: string | null; done_at: string | null
  packer: string | null; packed_at: string | null; weight: number | string | null
}
interface ProductRow extends Omit<Product, "minStock"> { min_stock: number }
interface MoveRow { id: number; sku: string; qty: number; kind: StockMove["kind"]; who: string | null; note: string | null; at: string }
interface LineRow { id: number; order_id: string; sku: string; qty: number; picked: number; loc_ok: boolean; dev_kind: DeviationKind | null; dev_found: number | null; dev_note: string | null; dev_photo_url: string | null }

// En ändring som väntar på nät. Foton sparas som data-URL tills de kan laddas upp.
type Queued =
  | { op: "claimMany"; ids: string[]; picker: string }
  | { op: "release"; id: string; picker: string }
  | { op: "confirmLocation" | "pickItem"; lineId: string; picker: string }
  | { op: "reportDeviation"; lineId: string; picker: string; kind: DeviationKind; found: number; note: string; photo: string | null }
  | { op: "finish"; id: string; picker: string }
  | { op: "pack"; id: string; packer: string; weight: number }
  | { op: "receive"; sku: string; qty: number; who: string }

const CACHE_KEY = "dpj-plock-cache-v1"
const QUEUE_KEY = "dpj-plock-queue-v1"

class Offline extends Error {}
const isNetworkError = (msg: string) => !navigator.onLine || /fetch|network|load failed|timed out/i.test(msg)

function supabaseStore(sb: SupabaseClient): Store {
  const subs = new Set<(s: Snapshot) => void>()
  const errs = new Set<(m: string) => void>()
  const stats = new Set<(s: SyncStatus) => void>()
  let channel: ReturnType<SupabaseClient["channel"]> | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let cache: State | null = read<State>(CACHE_KEY)
  let queue: Queued[] = read<Queued[]>(QUEUE_KEY) ?? []
  let online = navigator.onLine
  let flushing = false

  const status = () => { const s = { online, pending: queue.length }; stats.forEach(cb => cb(s)) }
  const setOnline = (v: boolean) => { if (online !== v) { online = v; status() } }
  const emit = () => { if (!cache) return; const snap = structuredClone(cache); subs.forEach(cb => cb(snap)) }
  const saveQueue = () => { write(QUEUE_KEY, queue); status() }

  const ts = (s: string | null) => (s ? Date.parse(s) : null)
  async function load() {
    if (queue.length) { void flush(); return }
    const [p, o, l, m] = await Promise.all([
      sb.from("products").select("*"),
      sb.from("orders").select("*"),
      sb.from("order_lines").select("*").order("id"),
      sb.from("stock_moves").select("*").eq("hidden", false).order("id", { ascending: false }).limit(30),
    ])
    const err = p.error || o.error || l.error || m.error
    if (err) {
      if (!isNetworkError(err.message)) errs.forEach(cb => cb(err.message))
      else if (cache) { setOnline(false); emit() }
      else { setOnline(false); errs.forEach(cb => cb("Ingen täckning, och inga order sparade i mobilen än. Anslut till nätet en gång.")) }
      return
    }
    setOnline(true)
    const products = Object.fromEntries((p.data as ProductRow[]).map(({ min_stock, ...x }) => [x.sku, { ...x, minStock: min_stock }]))
    const moves: StockMove[] = (m.data as MoveRow[]).map(x => ({ ...x, id: String(x.id), at: Date.parse(x.at) }))
    const byOrder = new Map<string, LineRow[]>()
    for (const r of l.data as LineRow[]) byOrder.set(r.order_id, [...(byOrder.get(r.order_id) || []), r])
    const orders: Order[] = (o.data as OrderRow[]).map(r => ({
      id: r.id, cust: r.cust, ship: r.ship, shipTxt: r.ship_txt, due: r.due, status: r.status,
      picker: r.picker, startedAt: ts(r.started_at), doneAt: ts(r.done_at),
      packer: r.packer, packedAt: ts(r.packed_at), weight: r.weight == null ? null : Number(r.weight),
      lines: (byOrder.get(r.id) || []).map(x => ({
        id: String(x.id), sku: x.sku, qty: x.qty, picked: x.picked, locOk: x.loc_ok,
        dev: x.dev_kind ? { kind: x.dev_kind, found: x.dev_found ?? 0, note: x.dev_note ?? "", photo: x.dev_photo_url } : null,
      })),
    }))
    cache = { products, orders, moves }
    write(CACHE_KEY, cache)
    emit()
  }
  const refresh = () => { clearTimeout(timer); timer = setTimeout(load, 120) }

  async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    if (!navigator.onLine) throw new Offline()
    const { data, error } = await sb.rpc(fn, args)
    if (error) { if (isNetworkError(error.message)) throw new Offline(); errs.forEach(cb => cb(error.message)); throw error }
    return data as T
  }

  async function upload(lineId: string, photo: Blob) {
    const path = `${lineId}/${Date.now()}.jpg`
    const up = await sb.storage.from("avvikelser").upload(path, photo, { contentType: "image/jpeg" })
    if (up.error) { if (isNetworkError(up.error.message)) throw new Offline(); return null }
    return sb.storage.from("avvikelser").getPublicUrl(path).data.publicUrl
  }

  async function remote(q: Queued): Promise<unknown> {
    switch (q.op) {
      case "claimMany": return call("claim_orders", { p_orders: q.ids, p_picker: q.picker })
      case "release": await call("release_order", { p_order: q.id, p_picker: q.picker }); return true
      case "confirmLocation": return call("confirm_location", { p_line: Number(q.lineId), p_picker: q.picker })
      case "pickItem": return call("pick_item", { p_line: Number(q.lineId), p_picker: q.picker })
      case "reportDeviation": {
        const url = q.photo ? await upload(q.lineId, await (await fetch(q.photo)).blob()) : null
        return call("report_deviation", { p_line: Number(q.lineId), p_picker: q.picker, p_kind: q.kind, p_found: q.found, p_note: q.note, p_photo_url: url })
      }
      case "finish": return call("finish_order", { p_order: q.id, p_picker: q.picker })
      case "pack": return call("pack_order", { p_order: q.id, p_packer: q.packer, p_weight: q.weight })
      case "receive": return call("receive_goods", { p_sku: q.sku, p_qty: q.qty, p_who: q.who })
    }
  }

  function local(q: Queued): unknown {
    const st = cache!
    switch (q.op) {
      case "claimMany": return ops.claimMany(st, q.ids, q.picker)
      case "release": ops.release(st, q.id, q.picker); return true
      case "confirmLocation": return ops.confirmLocation(st, q.lineId, q.picker)
      case "pickItem": return ops.pickItem(st, q.lineId, q.picker)
      case "reportDeviation": return ops.reportDeviation(st, q.lineId, q.picker, q.kind, q.found, q.note, q.photo)
      case "finish": return ops.finish(st, q.id, q.picker)
      case "pack": return ops.pack(st, q.id, q.packer, q.weight)
      case "receive": return ops.receive(st, q.sku, q.qty, q.who)
    }
  }

  // Skicka köade ändringar i ordning. En ändring som databasen säger nej till (någon annan hann före) hoppas över och räknas.
  async function flush() {
    if (flushing || !queue.length) return
    flushing = true
    let rejected = 0
    try {
      while (queue.length) {
        let r: unknown
        try { r = await remote(queue[0]) } catch (e) {
          if (e instanceof Offline) { setOnline(false); return }
          r = null
        }
        if (r === false || r == null) rejected++
        queue.shift(); saveQueue()
      }
      setOnline(true)
    } finally {
      flushing = false
      if (rejected) errs.forEach(cb => cb(`${rejected} ändringar från tiden utan nät gick inte att spara. Någon annan hann före, kontrollera orderna.`))
      if (!queue.length) void load()
    }
  }

  // Utan nät (eller med ändringar som väntar) görs ändringen i mobilens kopia och läggs i kön.
  async function act<T>(q: Queued): Promise<T> {
    if (!queue.length && navigator.onLine) {
      try { const r = await remote(q); await load(); return r as T } catch (e) { if (!(e instanceof Offline)) throw e }
      setOnline(false)
    }
    if (!cache) throw new Error("Ingen data sparad i mobilen än. Anslut till nätet en gång först.")
    const r = local(q)
    if (r === false || r == null) { emit(); return r as T }
    queue.push(q); saveQueue(); write(CACHE_KEY, cache); emit()
    if (navigator.onLine) void flush()
    return r as T
  }

  window.addEventListener("online", () => { setOnline(true); if (queue.length) void flush(); else void load() })
  window.addEventListener("offline", () => setOnline(false))
  setInterval(() => { if (queue.length && navigator.onLine) void flush() }, 15000)

  return {
    mode: "supabase",
    subscribe(cb, onError) {
      subs.add(cb); if (onError) errs.add(onError)
      if (cache) cb(structuredClone(cache))
      if (!channel) {
        channel = sb.channel("plock")
          .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, refresh)
          .on("postgres_changes", { event: "*", schema: "public", table: "order_lines" }, refresh)
          .on("postgres_changes", { event: "*", schema: "public", table: "products" }, refresh)
          .on("postgres_changes", { event: "*", schema: "public", table: "stock_moves" }, refresh)
          .subscribe()
      }
      void load()
      return () => { subs.delete(cb); if (onError) errs.delete(onError) }
    },
    onStatus(cb) { stats.add(cb); cb({ online, pending: queue.length }); return () => { stats.delete(cb) } },
    claimMany: (ids, picker) => act({ op: "claimMany", ids, picker }),
    release: (id, picker) => act({ op: "release", id, picker }),
    confirmLocation: (lineId, picker) => act({ op: "confirmLocation", lineId, picker }),
    pickItem: (lineId, picker) => act({ op: "pickItem", lineId, picker }),
    async reportDeviation(lineId, picker, kind, found, note, photo) {
      return act({ op: "reportDeviation", lineId, picker, kind, found, note, photo: photo ? await toDataUrl(photo) : null })
    },
    finish: (id, picker) => act({ op: "finish", id, picker }),
    pack: (id, packer, weight) => act({ op: "pack", id, packer, weight }),
    receive: (sku, qty, who) => act({ op: "receive", sku, qty, who }),
    async importOrders(list) {
      const n = await call<number>("import_orders", {
        p_orders: list.map(o => ({ id: o.id, cust: o.cust, ship: o.ship, ship_txt: o.shipTxt, due: o.due, lines: o.lines })),
      }).catch(e => { throw e instanceof Offline ? new Error("Importen kräver nät.") : e })
      await load(); return n
    },
    async reset() {
      await call<void>("reset_demo", {}).catch(e => { throw e instanceof Offline ? new Error("Återställningen kräver nät.") : e })
      queue = []; saveQueue(); await load()
    },
  }
}

export function createStore(): Store {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined
  if (import.meta.env.VITE_STORE === "local" || !url || !key) return localStore()
  return supabaseStore(createClient(url, key))
}
