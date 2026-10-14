// Simulering av hela flödet för demon: nya order kommer in av sig själva och virtuella medarbetare
// plockar, packar och fyller på hyllor genom samma funktioner som appen använder. Allt syns därför
// live i översikten och i plockappen, och "Återställ demon" tar bort det igen.
import { expectedWeight, lineDone, sortByLoc, type Order, type Snapshot } from "./data"
import type { NewOrder } from "./csv"
import type { Store } from "./store"
import { refillRows, stockRows } from "./Lager"
import { allocate, countTips, queueOrder } from "./prio"

export type SimKind = "order" | "claim" | "pick" | "dev" | "done" | "pack" | "in" | "count"
export interface SimEvent { id: number; at: number; kind: SimKind; who: string | null; text: string }
export interface SimStats { orders: number; picks: number; packed: number; devs: number; received: number; counted: number }
export type Speed = 1 | 3 | 8

export const SIM_PICKERS = ["Amir", "Jonna"]
export const SIM_PACKER = "Mikael"

const CUSTOMERS = ["Holm & Partners", "Sjöberg Arkitekter", "Nordljus Media", "Vinge Revision", "Kvarnbacken Skola", "Ekdahl Tandvård",
  "Lundqvist Bygg", "Stadsmissionen Väst", "Brf Utsikten", "Fors Advokatbyrå", "Tre Torn Konsult", "Arkadia Design"]

// En simulerad sekund i appen motsvarar en tick. Snabbare fart ger kortare ticks.
const TICK_MS: Record<Speed, number> = { 1: 1400, 3: 600, 8: 220 }

const pad = (n: number) => String(n).padStart(2, "0")
const hhmm = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const pickOne = <T,>(xs: T[], r: () => number) => xs[Math.floor(r() * xs.length)]

interface Picker { name: string; walk: number }

export class Simulation {
  running = false
  speed: Speed = 3
  events: SimEvent[] = []
  stats: SimStats = { orders: 0, picks: 0, packed: 0, devs: 0, received: 0, counted: 0 }
  private timer: ReturnType<typeof setTimeout> | null = null
  private busy = false
  private tick = 0
  private seq = 0
  private nextOrderAt = 0
  private packWait = 0
  private pickers: Picker[] = SIM_PICKERS.map(name => ({ name, walk: 0 }))
  private listeners = new Set<() => void>()
  private rand = Math.random

  private store: Store
  private snap: () => Snapshot | null
  constructor(store: Store, snap: () => Snapshot | null) { this.store = store; this.snap = snap }

  subscribe(cb: () => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb) } }
  private changed() { for (const cb of this.listeners) cb() }

  start() {
    if (this.running) return
    this.running = true
    this.nextOrderAt = this.tick + 2
    this.log("order", null, "Simuleringen startade. Order kommer in av sig själva.")
    this.schedule()
  }
  stop() {
    if (!this.running) return
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.log("order", null, "Simuleringen pausades.")
  }
  setSpeed(s: Speed) { this.speed = s; this.changed() }

  private schedule() {
    this.timer = setTimeout(async () => {
      if (!this.running) return
      if (!this.busy) {
        this.busy = true
        try { await this.step() } catch { /* nästa tick försöker igen */ } finally { this.busy = false }
      }
      if (this.running) this.schedule()
    }, TICK_MS[this.speed])
  }

  private log(kind: SimKind, who: string | null, text: string) {
    this.events = [{ id: ++this.seq, at: Date.now(), kind, who, text }, ...this.events].slice(0, 60)
    this.changed()
  }

  // Ett steg: kanske en ny order, sedan får varje medarbetare göra en sak.
  async step() {
    this.tick++
    const s = this.snap()
    if (!s) return
    if (this.tick >= this.nextOrderAt) {
      await this.newOrder(s)
      this.nextOrderAt = this.tick + 3 + Math.floor(this.rand() * 5)
    }
    for (const p of this.pickers) {
      const cur = this.snap()
      if (cur) await this.pickStep(p, cur)
    }
    const cur = this.snap()
    if (cur) await this.packStep(cur)
  }

  private async newOrder(s: Snapshot) {
    const skus = Object.keys(s.products)
    const n = 1 + Math.floor(this.rand() * 3)
    const lines = new Map<string, number>()
    while (lines.size < n) lines.set(pickOne(skus, this.rand), this.rand() < 0.75 ? 1 : 2)
    // Ibland en storkund som vill ha fler än det finns på hyllan, så omprioriteringen syns.
    if (this.rand() < 0.15) {
      const sku = pickOne(skus, this.rand)
      lines.set(sku, Math.max(3, s.products[sku].stock + 1 + Math.floor(this.rand() * 3)))
    }
    const exp = this.rand() < 0.3
    const now = Date.now()
    // Simulerade order får nummer från 300100 och uppåt, så de inte krockar med demons egna.
    const id = String(Math.max(300099, ...s.orders.map(o => Number(o.id)).filter(n => n >= 300000 && n < 400000)) + 1)
    const o: NewOrder = {
      id,
      cust: pickOne(CUSTOMERS, this.rand), ship: exp ? "exp" : "std", shipTxt: exp ? "Express Stockholm" : "PostNord",
      due: hhmm(now + (exp ? 60 : 180) * 60000), lines: [...lines].map(([sku, qty]) => ({ sku, qty })),
    }
    if (await this.store.importOrders([o])) {
      this.stats.orders++
      this.log("order", null, `Ny order ${o.id} från ${o.cust}${exp ? ", express" : ""}, ${o.lines.length} ${o.lines.length === 1 ? "rad" : "rader"}`)
    }
  }

  private async pickStep(p: Picker, s: Snapshot) {
    const mine = s.orders.filter(o => o.status === "plock" && o.picker === p.name)
    if (!mine.length) {
      // Ta en eller två order i prioritetsordning. Restorder får vänta tills hyllan fyllts på.
      const alloc = allocate(s.orders, s.products)
      const free = queueOrder(s.orders.filter(o => o.status === "ny" && alloc.get(o.id)?.ok), alloc)
      // Med få order i kön tar de det lugnt, så det finns något kvar att plocka för den som provar appen.
      if (!free.length || (free.length < 3 && this.rand() < 0.6)) return
      const ids = free.slice(0, free.length > 2 && this.rand() < 0.5 ? 2 : 1).map(o => o.id)
      if (await this.store.claimMany(ids, p.name)) {
        p.walk = 3
        this.log("claim", p.name, ids.length > 1 ? `${p.name} tog en runda med order ${ids.join(" och ")}` : `${p.name} började plocka order ${ids[0]}`)
      }
      return
    }
    // Färdiga order i rundan lämnas till packbordet.
    for (const o of mine.filter(o => o.lines.every(lineDone))) {
      const st = await this.store.finish(o.id, p.name)
      if (st) this.log("done", p.name, st === "avv" ? `${p.name} lämnade order ${o.id} med avvikelse` : `${p.name} lämnade order ${o.id} till pack`)
      return
    }
    if (p.walk > 0) { p.walk--; return }
    // Nästa rad i gångordning, över alla order i rundan.
    const s2 = s.products
    const lines = sortByLoc(mine.flatMap(o => o.lines.filter(l => !lineDone(l))), s2)
    const l = lines[0]
    if (!l) return
    const prod = s2[l.sku]
    if (!l.locOk) {
      if (await this.store.confirmLocation(l.id, p.name)) this.log("pick", p.name, `${p.name} skannade hylla ${prod?.loc}`)
      return
    }
    // Ibland saknas eller är en vara skadad, så avvikelseflödet också syns.
    if (l.picked === 0 && this.rand() < 0.08) {
      const kind = this.rand() < 0.6 ? "Skadad" : "Saknas"
      if (await this.store.reportDeviation(l.id, p.name, kind, Math.max(0, l.qty - 1), kind === "Skadad" ? "Trasig kartong" : "Tom hylla", null)) {
        this.stats.devs++
        this.log("dev", p.name, `${p.name} rapporterade ${kind.toLowerCase()} på ${prod?.name ?? l.sku} (${prod?.loc})`)
      }
      return
    }
    const n = await this.store.pickItem(l.id, p.name)
    if (n != null) {
      this.stats.picks++
      this.log("pick", p.name, `${p.name} plockade ${prod?.name ?? l.sku}, ${prod?.variant} (${n}/${l.qty})`)
      if (n >= l.qty) p.walk = 2
    }
  }

  private async packStep(s: Snapshot) {
    if (this.packWait > 0) { this.packWait--; return }
    const ready = s.orders.filter(o => o.status === "pack" || o.status === "avv").sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0))
    const o: Order | undefined = ready[0]
    if (o) {
      const w = Math.round(expectedWeight(o, s.products) * (0.97 + this.rand() * 0.06) * 10) / 10
      if (await this.store.pack(o.id, SIM_PACKER, w)) {
        this.stats.packed++
        this.packWait = 2
        this.log("pack", SIM_PACKER, `${SIM_PACKER} packade order ${o.id}, ${w.toLocaleString("sv-SE")} kg, skickad med ${o.shipTxt}`)
      }
      return
    }
    // Inget att packa: räkna en hylla med avvikelse, annars fyll på den som behöver det mest.
    // Restorder väntar på varor: då går påfyllnaden före allt annat.
    const urgent = [...allocate(s.orders, s.products).values()].some(x => !x.ok)
    const tip = countTips(s.products, s.orders, s.moves).find(x => x.reason === "dev" || x.reason === "empty" || x.reason === "short")
    if (tip && this.rand() < (urgent ? 0.15 : 0.4)) {
      const p = s.products[tip.sku]
      // Ibland står det några kvar längst in på hyllan, ibland stämmer saldot.
      const counted = Math.max(0, p.stock) + (this.rand() < 0.5 ? Math.floor(this.rand() * 4) : 0)
      if (await this.store.count(p.sku, counted, SIM_PACKER, counted !== p.stock ? "Hittade fler längst in" : "") != null) {
        this.stats.counted++
        this.packWait = 2
        const d = counted - p.stock
        this.log("count", SIM_PACKER, `${SIM_PACKER} inventerade ${p.loc}: ${counted} st${d ? ` (${d > 0 ? "+" : ""}${d} mot saldot)` : ", stämde"}`)
      }
      return
    }
    const r = refillRows(stockRows(s.products, s.orders))[0]
    if (r && (urgent || this.rand() < 0.5)) {
      const qty = r.need + r.p.minStock
      if (await this.store.receive(r.p.sku, qty, SIM_PACKER) != null) {
        this.stats.received += qty
        this.packWait = 3
        this.log("in", SIM_PACKER, `${SIM_PACKER} fyllde på ${r.p.loc} med ${qty} st ${r.p.name}`)
      }
    }
  }
}
