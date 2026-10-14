import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Barcode, Boxes, Camera, Check, ChevronLeft, Clock, LayoutDashboard, ListChecks, Lock, LogOut, Minus, PackageCheck, PackagePlus, Plus, RotateCcw, ScanLine, Truck, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import {
  DEVIATION_KINDS, kolli, lineDone, mins, sortByLoc,
  type DeviationKind, type Line, type Order, type Products, type Snapshot, type Status,
} from "./data"
import { createStore, type SyncStatus } from "./store"
import { currentUser, logout, type User } from "./auth"
import { LANGS, lang, setLang, t } from "./i18n"
import Login, { Avatar, Logo } from "./Login"
import { Chip, Header, Pict, ScanBar, DemoLabel } from "./parts"
import { Inleverans, Inventering, Saldo, refillRows, stockRows } from "./Lager"
import { Pack, PackingSlip } from "./Pack"

const store = createStore()

type Tab = "queue" | "pack" | "inleverans" | "saldo" | "inventering"
type View = { name: Tab } | { name: "pick" } | { name: "done" }
// En plockrunda är plockarens pågående order (en eller flera). Varje order får en låda.
type RoundLine = Line & { orderId: string; box: number }
interface Round { orders: Order[]; lines: RoundLine[] }
const MAX_ROUND = 4

function roundOf(orders: Order[], me: string): Round {
  const mine = orders.filter(o => o.status === "plock" && o.picker === me).sort((a, b) => a.id.localeCompare(b.id))
  return { orders: mine, lines: mine.flatMap((o, k) => o.lines.map(l => ({ ...l, orderId: o.id, box: k + 1 }))) }
}
type FlashKind = "ok" | "err" | "warn"
interface Flash { kind: FlashKind; title: string; sub?: string; sticky?: boolean; n: number }

const STATUS: Record<Status, string> = {
  ny: "bg-secondary text-secondary-foreground",
  plock: "bg-warn-soft text-warn",
  pack: "bg-ok-soft text-ok",
  avv: "bg-bad-soft text-destructive",
  skickad: "bg-secondary text-secondary-foreground",
}

let actx: AudioContext | undefined
function feedback(kind: FlashKind) {
  try { navigator.vibrate?.(kind === "err" ? [120, 60, 120, 60, 220] : kind === "ok" ? 40 : 80) } catch { /* ok */ }
  try {
    actx = actx || new AudioContext()
    const o = actx.createOscillator(), g = actx.createGain()
    o.type = kind === "err" ? "square" : "sine"
    o.frequency.value = kind === "err" ? 220 : kind === "ok" ? 1320 : 660
    g.gain.value = 0.08; o.connect(g); g.connect(actx.destination)
    o.start(); o.stop(actx.currentTime + (kind === "err" ? 0.45 : 0.09))
  } catch { /* ok */ }
}

function currentLine(r: Round, products: Products, sel: number | null) {
  const lines = sortByLoc(r.lines, products)
  const i = sel != null && lines[sel] && !lineDone(lines[sel]) ? sel : lines.findIndex(l => !lineDone(l))
  return { lines, i, line: i >= 0 ? lines[i] : undefined as RoundLine | undefined }
}

export default function App() {
  const [user, setUser] = useState<User | null>(currentUser)
  return user ? <Picking user={user} onLogout={() => { logout(); setUser(null) }} /> : <Login onLogin={setUser} />
}

function Picking({ user, onLogout }: { user: User; onLogout: () => void }) {
  const me = user.name
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [view, setView] = useState<View>({ name: "queue" })
  const [sel, setSel] = useState<number | null>(null)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [devOpen, setDevOpen] = useState(false)
  const [shakeN, setShakeN] = useState(0)
  const [slip, setSlip] = useState<Order | null>(null)
  const [focusSku, setFocusSku] = useState<string | null>(null)
  const busy = useRef(false)

  const [sync, setSync] = useState<SyncStatus>({ online: true, pending: 0 })
  useEffect(() => store.subscribe(setSnap, msg => say("err", t("f.saveError"), msg, true)), [])
  useEffect(() => store.onStatus(setSync), [])
  useEffect(() => {
    if (!flash || flash.sticky) return
    const t = setTimeout(() => setFlash(null), 1700)
    return () => clearTimeout(t)
  }, [flash])

  function say(kind: FlashKind, title: string, sub?: string, sticky?: boolean) { setFlash({ kind, title, sub, sticky, n: Date.now() }); feedback(kind) }
  const noCamera = () => say("warn", t("f.camera"), t("f.cameraSub"), true)
  const go = (v: View) => { setView(v); setSel(null); window.scrollTo(0, 0) }
  const goSku = (t: Tab, sku: string) => { setFocusSku(sku); go({ name: t }) }
  const once = async (fn: () => Promise<void>) => {
    if (busy.current) return
    busy.current = true
    try { await fn() } catch { /* felet visas via onError */ } finally { busy.current = false }
  }

  if (!snap) return <Skeleton />
  const { products, orders } = snap
  const round = roundOf(orders, me)
  const tab = view.name === "pick" || view.name === "done" ? null : view.name

  async function handleScan(raw: string) {
    const code = raw.trim().toUpperCase()
    if (!code) return
    const { line: l } = currentLine(round, products, sel)
    if (!l) return
    const p = products[l.sku]
    const byEan = Object.values(products).find(q => q.ean === code)
    const byLoc = Object.values(products).find(q => q.loc === code)
    const bump = () => setShakeN(n => n + 1)
    if (!l.locOk) {
      if (code === p.loc) {
        await once(async () => { if (await store.confirmLocation(l.id, me)) say("ok", t("f.rightShelf", { loc: p.loc }), t("f.scanItem")) })
      } else if (byLoc) { say("warn", t("f.wrongShelf", { code }), t("f.goTo", { loc: p.loc })); bump() }
      else if (byEan) { say("warn", t("f.shelfFirst"), t("f.shelfIs", { loc: p.loc })); bump() }
      else { say("warn", t("f.unknown"), code); bump() }
      return
    }
    if (code === p.ean) {
      await once(async () => {
        const n = await store.pickItem(l.id, me)
        if (n == null) return
        if (n >= l.qty) {
          setSel(null)
          const next = currentLine({ ...round, lines: round.lines.map(x => x.id === l.id ? { ...x, picked: n } : x) }, products, null).line
          const box = round.orders.length > 1 ? t("f.inBox", { n: l.box }) : ""
          say("ok", t("f.rowDone", { n: l.qty, box }), next ? t("f.next", { loc: products[next.sku].loc }) : t("f.allPicked"))
        } else say("ok", t("f.ofQty", { n, q: l.qty }), round.orders.length > 1 ? t("f.boxScanMore", { b: l.box, n: l.qty - n }) : t("f.scanMore", { n: l.qty - n }))
      })
    } else if (byEan) {
      say("err", t("f.wrongItem"), t("f.wrongItemSub", { name: byEan.name, variant: byEan.variant, want: p.variant }), true); bump()
    } else if (byLoc) say("warn", t("f.shelfAlready"), t("scan.item"))
    else { say("warn", t("f.unknown"), code); bump() }
  }

  return (
    <>
    <div className="min-h-full print:hidden">
      <FlashBanner flash={flash} onClose={() => setFlash(null)} />
      <SyncBar sync={sync} />
      {tab && <TopBar user={user} sync={sync} onLogout={onLogout} tab={tab} onTab={t => { setFocusSku(null); go({ name: t }) }} refill={refillRows(stockRows(products, orders)).length}
        onReset={() => once(async () => { await store.reset(); say("ok", t("f.resetOk")) })} />}
      {view.name === "inleverans" && (
        <Inleverans products={products} moves={snap.moves} say={say} onNoCamera={noCamera} preset={focusSku}
          onReceive={(sku, qty) => store.receive(sku, qty, me)} />
      )}
      {view.name === "inventering" && (
        <Inventering products={products} orders={orders} moves={snap.moves} say={say} preset={focusSku} onNoCamera={noCamera}
          onCount={(sku, n, note) => store.count(sku, n, me, note)} onDone={() => go({ name: "saldo" })} />
      )}
      {view.name === "pack" && (
        <Pack orders={orders} products={products} me={me} say={say} onNoCamera={noCamera}
          onPack={(id, w) => store.pack(id, me, w)}
          onPrint={o => { setSlip(o); setTimeout(() => window.print(), 150) }} />
      )}
      {view.name === "saldo" && <Saldo products={products} orders={orders}
        onRefill={sku => goSku("inleverans", sku)} onCount={sku => goSku("inventering", sku)} />}
      {view.name === "queue" && (
        <Queue orders={orders} user={user}
          onStart={ids => once(async () => {
            if (await store.claimMany(ids, me)) go({ name: "pick" })
            else say("warn", ids.length > 1 ? t("f.takenMany") : t("f.taken"), t("f.takenSub"))
          })}
          onOpen={() => go({ name: "pick" })} />
      )}
      {(view.name === "pick" || view.name === "done") && !round.orders.length && <p className="p-6 text-muted-foreground">{t("queue.none")} <button className="underline" onClick={() => go({ name: "queue" })}>{t("queue.toQueue")}</button></p>}
      {view.name === "pick" && round.orders.length > 0 && (
        <>
          <Pick r={round} products={products} sel={sel} setSel={setSel} shakeN={shakeN}
            onBack={() => go({ name: "queue" })}
            onScan={handleScan}
            onNoCamera={noCamera}
            onDeviation={() => setDevOpen(true)}
            onFinish={() => go({ name: "done" })}
            onRelease={() => once(async () => {
              for (const o of round.orders) await store.release(o.id, me)
              say("ok", round.orders.length > 1 ? t("f.releasedMany", { n: round.orders.length }) : t("f.released", { id: round.orders[0].id }), t("f.releasedSub")); go({ name: "queue" })
            })} />
          <DeviationSheet open={devOpen} onOpenChange={setDevOpen} line={currentLine(round, products, sel).line} products={products}
            onSave={(kind, found, note, photo) => once(async () => {
              const l = currentLine(round, products, sel).line
              if (!l) return
              await store.reportDeviation(l.id, me, kind, found, note, photo)
              setSel(null); setDevOpen(false)
              say("warn", t("f.flagged", { kind: t(`dev.${kind}`) }), t("f.flaggedSub", { id: l.orderId }))
            })} />
        </>
      )}
      {view.name === "done" && round.orders.length > 0 && (
        <Done r={round} products={products} onBack={() => setView({ name: "pick" })}
          onSend={() => once(async () => {
            const res = []
            for (const o of round.orders) res.push(await store.finish(o.id, me))
            if (res.some(x => !x)) { say("warn", t("f.sendFail"), t("f.sendFailSub")); return }
            const n = res.length
            say("ok", n > 1 ? t("f.sentMany", { n }) : t("f.sent", { id: round.orders[0].id }), res.includes("avv") ? t("f.sentDev") : t("f.good"))
            go({ name: "queue" })
          })} />
      )}
    </div>
    {slip && <PackingSlip o={slip} products={products} />}
    </>
  )
}

/* ---------- Delar ---------- */

function SyncBar({ sync }: { sync: SyncStatus }) {
  if (sync.online && !sync.pending) return null
  return (
    <div role="status" className={cn("px-4 py-2 text-center text-[13px] font-semibold", sync.online ? "bg-secondary text-secondary-foreground" : "bg-warn-soft text-warn")}>
      {sync.online
        ? t("sync.sending", { n: sync.pending })
        : t("sync.offline", { extra: sync.pending ? t("sync.pending", { n: sync.pending }) : "" })}
    </div>
  )
}

function FlashBanner({ flash, onClose }: { flash: Flash | null; onClose: () => void }) {
  return (
    <div role="alert" aria-live="assertive"
      className={cn("fixed inset-x-0 top-0 z-[60] flex items-start gap-3 px-4 pb-3.5 pt-[calc(env(safe-area-inset-top,0px)+14px)] shadow-lg transition-transform duration-200",
        flash ? "translate-y-0" : "-translate-y-[110%]",
        flash?.kind === "ok" && "bg-ok text-white",
        flash?.kind === "err" && "bg-destructive text-white",
        flash?.kind === "warn" && "bg-strip text-strip-foreground")}>
      {flash && (
        <>
          {flash.kind === "err" ? <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" /> : flash.kind === "ok" ? <Check className="mt-0.5 h-6 w-6 shrink-0" strokeWidth={3} /> : <ScanLine className="mt-0.5 h-6 w-6 shrink-0" />}
          <div className="min-w-0">
            <div className="text-lg font-bold leading-tight">{flash.title}</div>
            {flash.sub && <div className="mt-0.5 text-[15px] font-medium opacity-95">{flash.sub}</div>}
          </div>
          {flash.sticky && <button onClick={onClose} className="ml-auto rounded-md bg-white/20 px-3 py-1.5 font-bold">OK</button>}
        </>
      )}
    </div>
  )
}

function Pill({ s }: { s: Status }) {
  return <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide", STATUS[s])}>{t(`status.${s}`)}</span>
}
function ShipBadge({ o }: { o: Order }) {
  return o.ship === "exp"
    ? <Badge className="gap-1 rounded bg-strip text-strip-foreground shadow-none hover:bg-strip"><Zap className="h-3 w-3" />{t("p.express")}</Badge>
    : <Badge variant="outline" className="gap-1 rounded"><Truck className="h-3 w-3" />{o.shipTxt.split(" ")[0]}</Badge>
}

const TABS: { k: Tab; icon: typeof ListChecks }[] = [
  { k: "queue", icon: ListChecks }, { k: "pack", icon: PackageCheck }, { k: "inleverans", icon: PackagePlus }, { k: "saldo", icon: Boxes },
]
const TAB_LABEL: Record<string, string> = { queue: "tab.queue", pack: "tab.pack", inleverans: "tab.in", saldo: "tab.saldo" }

// Appens topp: logga, var man är och kontot. Menyn ligger i botten som i en vanlig mobilapp.
function TopBar({ user, sync, onLogout, onReset, tab, onTab, refill }: {
  user: User; sync: SyncStatus; onLogout: () => void; onReset: () => void; tab: Tab; onTab: (t: Tab) => void; refill: number
}) {
  const [open, setOpen] = useState(false)
  const live = store.mode === "local" ? "local" : sync.online ? "on" : "off"
  return (
    <>
      <header className="sticky top-0 z-30 border-b bg-header/95 pt-[env(safe-area-inset-top,0px)] backdrop-blur supports-[backdrop-filter]:bg-header/80">
        <div className="mx-auto flex h-14 max-w-xl items-center gap-3 px-4">
          <Logo />
          <span className="h-5 w-px bg-border" />
          <span className="text-sm font-semibold text-muted-foreground">{t(TAB_LABEL[tab])}</span>
          <div className="flex-1" />
          <span className={cn("hidden items-center gap-1.5 text-xs font-semibold min-[380px]:flex",
            live === "local" ? "text-muted-foreground" : live === "on" ? "text-ok" : "text-warn")}>
            <span className={cn("h-2 w-2 rounded-full", live === "local" ? "bg-muted-foreground" : live === "on" ? "bg-ok animate-pulse" : "bg-warn")} />
            {t(`live.${live}`)}
          </span>
          <button onClick={() => setOpen(true)} aria-label={user.name}
            className="rounded-full ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar name={user.name} size="sm" />
          </button>
        </div>
      </header>

      <nav aria-label={t("nav.menu")}
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="mx-auto grid max-w-xl grid-cols-4">
          {TABS.map(({ k, icon: Icon }) => {
            const on = tab === k
            return (
              <button key={k} onClick={() => onTab(k)} aria-current={on ? "page" : undefined}
                className={cn("relative flex h-16 flex-col items-center justify-center gap-1 text-[12px] font-semibold transition-colors",
                  on ? "text-primary" : "text-muted-foreground")}>
                {on && <span className="absolute inset-x-6 top-0 h-[3px] rounded-b bg-primary" />}
                <span className="relative">
                  <Icon className="h-6 w-6" strokeWidth={on ? 2.4 : 1.9} />
                  {k === "saldo" && refill > 0 && (
                    <span aria-hidden className="absolute -right-2.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-warn px-1 text-[11px] font-bold text-white ring-2 ring-card">{refill}</span>
                  )}
                </span>
                {t(TAB_LABEL[k])}
                {k === "saldo" && refill > 0 && <span className="sr-only">, {t("nav.refill", { n: refill })}</span>}
              </button>
            )
          })}
        </div>
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="mx-auto max-w-xl rounded-t-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
          <SheetHeader className="text-left">
            <div className="flex items-center gap-3">
              <Avatar name={user.name} size="lg" />
              <div>
                <SheetTitle className="text-xl font-extrabold">{user.name}</SheetTitle>
                <SheetDescription>{t(`role.${user.role}`)}</SheetDescription>
              </div>
            </div>
          </SheetHeader>
          <div className="mt-5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{t("common.language")}</div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {LANGS.map(l => (
              <button key={l.code} onClick={() => l.code !== lang && setLang(l.code)} aria-pressed={l.code === lang}
                className={cn("h-11 rounded-md border text-sm font-semibold", l.code === lang ? "border-primary bg-primary text-primary-foreground" : "bg-card")}>{l.name}</button>
            ))}
          </div>
          <div className="mt-5 divide-y rounded-lg border">
            <a href="/etiketter.html" className="flex items-center gap-3 px-4 py-3 text-[15px] font-medium"><Barcode className="h-5 w-5 text-muted-foreground" />{t("link.labels")}</a>
            {user.role === "ledare" && <a href="/admin.html" className="flex items-center gap-3 px-4 py-3 text-[15px] font-medium"><LayoutDashboard className="h-5 w-5 text-muted-foreground" />{t("link.admin")}</a>}
            <button onClick={() => { setOpen(false); onReset() }} className="flex w-full items-center gap-3 px-4 py-3 text-left text-[15px] font-medium"><RotateCcw className="h-5 w-5 text-muted-foreground" />{t("link.reset")}</button>
          </div>
          <p className="mt-4 rounded-md bg-muted px-3 py-2 text-[13px] text-muted-foreground">{t("queue.demo")}</p>
          <Button variant="outline" className="mt-4 h-12 w-full text-base font-semibold" onClick={onLogout}><LogOut className="!h-4 !w-4" />{t("nav.logout")}</Button>
        </SheetContent>
      </Sheet>
    </>
  )
}

// Visas medan orderkön hämtas: samma form som kön, så sidan inte hoppar när datan kommer.
function Skeleton() {
  const bar = "animate-pulse rounded-md bg-muted"
  return (
    <div className="min-h-screen" aria-busy="true" aria-label={t("common.loading")}>
      <div className="h-14 border-b bg-card" />
      <main className="mx-auto max-w-xl px-4">
        <div className={cn(bar, "mt-6 h-7 w-40")} />
        <div className={cn(bar, "mt-2 h-4 w-56")} />
        <div className="mt-4 grid grid-cols-4 gap-2">{[0, 1, 2, 3].map(k => <div key={k} className={cn(bar, "h-16")} />)}</div>
        <div className="mt-8 grid gap-2.5">{[0, 1, 2].map(k => <div key={k} className={cn(bar, "h-32 rounded-xl")} />)}</div>
      </main>
    </div>
  )
}

/* ---------- Orderkö ---------- */

function Queue({ orders, user, onStart, onOpen }: {
  orders: Order[]; user: User; onStart: (ids: string[]) => void; onOpen: () => void
}) {
  const me = user.name
  const [picked, setPicked] = useState<string[]>([])
  const rank = (o: Order) => ({ plock: 0, ny: 1, avv: 2, pack: 3, skickad: 4 }[o.status] * 10 + (o.ship === "exp" ? 0 : 5))
  const list = [...orders].sort((a, b) => rank(a) - rank(b) || a.due.localeCompare(b.due))
  const cnt = (k: Status) => orders.filter(o => o.status === k).length
  const active = orders.find(o => o.status === "plock" && o.picker === me)
  const chosen = picked.filter(id => orders.some(o => o.id === id && o.status === "ny"))
  const toggle = (id: string) => setPicked(chosen.includes(id) ? chosen.filter(x => x !== id) : [...chosen, id].slice(0, MAX_ROUND))
  const groups: [string, Order[]][] = [
    [t("group.now"), list.filter(o => o.status === "plock")],
    [t("group.today"), list.filter(o => o.status === "ny")],
    [t("group.done"), list.filter(o => o.status === "pack" || o.status === "avv" || o.status === "skickad")],
  ]
  return (
    <>
      <main className="mx-auto max-w-xl px-4 pb-36">
        <div className="mt-5 flex items-baseline gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("queue.hi", { name: me })}</h1>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`role.${user.role}`)}</span>
        </div>
        <p className="text-muted-foreground">{t("queue.waiting", { n: cnt("ny") })}</p>
        <div className="mt-4 grid grid-cols-4 gap-2">
          {(["ny", "plock", "avv", "pack"] as Status[]).map(k => (
            <div key={k} className="rounded-lg border bg-card px-2.5 py-2.5 shadow-sm">
              <div className={cn("text-2xl font-extrabold leading-none tabular-nums", k === "avv" && cnt(k) > 0 && "text-destructive")}>{cnt(k)}</div>
              <div className="mt-1 text-[11px] font-medium leading-tight text-muted-foreground">{t(`kpi.${k}`)}</div>
            </div>
          ))}
        </div>
        {groups.map(([title, items]) => items.length > 0 && (
          <section key={title}>
            <h2 className="mb-2 mt-7 text-[13px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{title}</h2>
            <div className="grid gap-2.5">
              {items.map(o => {
                const mine = o.status === "plock" && o.picker === me
                const doneRows = o.lines.filter(lineDone).length
                const on = chosen.includes(o.id)
                return (
                  <article key={o.id} className={cn("rise rounded-xl border bg-card p-3.5 shadow-sm transition-shadow", (mine || on) && "border-primary ring-1 ring-primary")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <ShipBadge o={o} />
                      <span className="font-mono text-[13px] text-muted-foreground">#{o.id}</span>
                      {o.status === "ny" && !active && (
                        <button onClick={() => toggle(o.id)} aria-pressed={on} disabled={!on && chosen.length >= MAX_ROUND}
                          className={cn("ml-auto flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold disabled:opacity-40",
                            on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground")}>
                          {on ? <><Check className="h-3.5 w-3.5" strokeWidth={3} />{t("queue.box", { n: [...chosen].sort((a, b) => a.localeCompare(b)).indexOf(o.id) + 1 })}</> : t("queue.add")}
                        </button>
                      )}
                    </div>
                    <div className="mt-1.5 font-semibold text-card-foreground">{o.cust}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{t("queue.due", { t: o.due })}</span>
                      <span>{t("queue.rows", { n: o.lines.length, k: kolli(o) })}</span>
                      {o.status === "plock" && <span>{t("queue.doneRows", { a: doneRows, b: o.lines.length })}</span>}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <Pill s={o.status} />
                      <div className="flex-1" />
                      {o.status === "ny" && !chosen.length && <Button className="h-11 px-5 text-[15px] font-bold" disabled={!!active} onClick={() => onStart([o.id])}>{t("queue.start")}</Button>}
                      {mine && <Button className="h-11 px-5 text-[15px] font-bold" onClick={onOpen}>{t("queue.continue")}</Button>}
                      {o.status === "plock" && !mine && <span className="flex items-center gap-1 text-sm text-muted-foreground"><Lock className="h-3.5 w-3.5" />{t("queue.locked", { name: o.picker ?? "" })}</span>}
                      {(o.status === "pack" || o.status === "avv") && o.doneAt && o.startedAt && <span className="text-sm text-muted-foreground">{o.picker} · {t("common.min", { n: mins(o.doneAt - o.startedAt) })}</span>}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))}
        {active && <p className="mt-4 text-sm text-muted-foreground">{t("queue.active")}</p>}
        {!active && !chosen.length && cnt("ny") > 1 && <p className="mt-4 text-sm text-muted-foreground">{t("queue.tip", { n: MAX_ROUND })}</p>}
      </main>
      {chosen.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] z-30 border-t bg-card px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <div className="min-w-0 flex-1 text-sm leading-tight">
              <div className="font-bold">{t("round.n", { n: chosen.length })}</div>
              <div className="text-muted-foreground">{t("round.kolli", { n: chosen.reduce((n, id) => n + kolli(orders.find(o => o.id === id)!), 0) })} · <button className="underline" onClick={() => setPicked([])}>{t("round.clear")}</button></div>
            </div>
            <Button className="h-12 px-5 text-[15px] font-bold" onClick={() => onStart(chosen)}>{t("round.start")}</Button>
          </div>
        </div>
      )}
    </>
  )
}

/* ---------- Plock ---------- */

const BOX = ["", "bg-sky-200 text-sky-950", "bg-amber-200 text-amber-950", "bg-emerald-200 text-emerald-950", "bg-rose-200 text-rose-950"]
const Box = ({ n, className }: { n: number; className?: string }) =>
  <span className={cn("inline-grid h-6 min-w-6 place-items-center rounded px-1 text-xs font-extrabold", BOX[n], className)} aria-label={t("queue.box", { n })}>{n}</span>

function Pick({ r, products, sel, setSel, shakeN, onBack, onScan, onNoCamera, onDeviation, onFinish, onRelease }: {
  r: Round; products: Products; sel: number | null; setSel: (n: number | null) => void; shakeN: number
  onBack: () => void; onScan: (c: string) => void; onNoCamera: () => void; onDeviation: () => void; onFinish: () => void; onRelease: () => void
}) {
  const { lines, i, line } = currentLine(r, products, sel)
  const multi = r.orders.length > 1
  const o = r.orders[0]
  const lineOrder = line && r.orders.find(x => x.id === line.orderId)
  const done = lines.filter(lineDone).length
  const curRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const c = curRef.current; if (!c || !shakeN) return
    c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake")
  }, [shakeN])

  const p = line ? products[line.sku] : undefined
  const step = line?.locOk ? 2 : 1
  const left = lines.filter(l => !lineDone(l)).length
  const all = Object.values(products)
  const sib = p && all.find(q => q !== p && q.type === p.type)
  const wrongLoc = p && (all.find(q => q.loc !== p.loc && q.loc[0] === p.loc[0]) || all.find(q => q.loc !== p.loc))
  const otherEan = p && (sib ? sib.ean : all.find(q => q !== p)?.ean)

  return (
    <>
      <Header>
        <Button variant="ghost" className="-ml-3 h-10 px-2 text-base font-semibold" onClick={onBack}><ChevronLeft className="!h-5 !w-5" />{t("queue.back")}</Button>
        <div className="flex-1" />
        <div className="min-w-0 text-right">
          {multi ? (
            <>
              <div className="text-sm font-bold">{t("pick.round", { n: r.orders.length })}</div>
              <div className="truncate font-mono text-[13px] text-muted-foreground">{r.orders.map(x => `#${x.id}`).join(" ")}</div>
            </>
          ) : (
            <>
              <div className="font-mono text-sm">#{o.id}</div>
              <div className="truncate text-[13px] text-muted-foreground">{o.cust}</div>
            </>
          )}
        </div>
      </Header>
      <main className="mx-auto max-w-xl px-4 pb-36">
        <div className="mt-4 flex justify-between text-sm tabular-nums text-muted-foreground">
          <span>{t("pick.rows", { a: done, b: lines.length })}</span>
          {(() => { const first = [...r.orders].sort((a, b) => a.due.localeCompare(b.due))[0]; return <span className="flex items-center gap-1.5"><ShipBadge o={first} />{t("pick.out", { t: first.due })}</span> })()}
        </div>
        <Progress value={done / Math.max(1, lines.length) * 100} className="mt-2 h-2 bg-secondary [&>div]:bg-ok" />

        {line && p ? (
          <>
            <div ref={curRef} className="mt-4 overflow-hidden rounded-md border bg-card">
              <div className={cn("flex", line.locOk ? "bg-ok text-white" : "bg-sign text-sign-foreground")}>
                <div className="flex-1 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-75">{line.locOk ? t("pick.shelfOk") : t("pick.shelf")}</div>
                  <div className="text-[52px] font-extrabold leading-none tracking-tight tabular-nums">
                    <span className={line.locOk ? "" : "text-sign-accent"}>{p.loc.split("-")[0]}</span>-{p.loc.split("-").slice(1).join("-")}
                  </div>
                </div>
                <div className="border-l border-white/20 px-4 py-3 text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-75">{t("pick.qty")}</div>
                  <div className="text-[46px] font-extrabold leading-none tabular-nums">{line.qty}</div>
                </div>
              </div>
              {multi && lineOrder && (
                <div className={cn("flex items-center gap-3 px-4 py-2", BOX[line.box])}>
                  <span className="whitespace-nowrap text-2xl font-extrabold">{t("pick.box", { n: line.box })}</span>
                  <span className="ml-auto min-w-0 truncate text-right text-sm font-semibold">#{lineOrder.id}<span className="block truncate font-normal">{lineOrder.cust}</span></span>
                </div>
              )}
              <div className="flex items-center gap-3.5 px-4 py-3.5">
                <div className="grid h-16 w-16 shrink-0 place-items-center rounded bg-muted text-muted-foreground"><Pict type={p.type} className="h-11 w-11" /></div>
                <div className="min-w-0">
                  {p.brand && <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{p.brand}</div>}
                  <div className="text-lg font-bold leading-tight text-card-foreground">{p.name}</div>
                  <div className="mt-1"><span className="rounded bg-accent px-1.5 py-0.5 text-[16px] font-bold text-accent-foreground">{p.variant}</span></div>
                  <div className="mt-1.5 break-all font-mono text-xs text-muted-foreground">{line.sku} · EAN {p.ean}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{t("pick.stock", { n: p.stock })}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 border-t text-sm">
                <div className={cn("flex items-center gap-2 px-4 py-2.5", step === 1 ? "bg-warn-soft font-bold text-foreground" : "text-muted-foreground")}>
                  <span className={cn("grid h-6 w-6 place-items-center rounded-full border-2 text-xs font-bold", step === 1 ? "border-warn text-warn" : "border-ok bg-ok text-white")}>{step === 1 ? "1" : <Check className="h-3.5 w-3.5" strokeWidth={3} />}</span>
                  {t("pick.step1")}
                </div>
                <div className={cn("flex items-center gap-2 border-l px-4 py-2.5", step === 2 ? "bg-warn-soft font-bold text-foreground" : "text-muted-foreground")}>
                  <span className={cn("grid h-6 w-6 place-items-center rounded-full border-2 text-xs font-bold", step === 2 ? "border-warn text-warn" : "border-border")}>2</span>
                  {t("pick.step2")}
                  {step === 2 && <span className="ml-auto text-lg font-extrabold tabular-nums">{line.picked}/{line.qty}</span>}
                </div>
              </div>
            </div>

            <ScanBar placeholder={step === 1 ? t("scan.shelf") : t("scan.item")} onScan={onScan} onNoCamera={onNoCamera}
              hint={step === 1 ? t("hint.shelf") : t("hint.item")} focusKey={`${i}-${line.locOk}-${line.picked}`} />

            <div className="demo-box mt-3 flex flex-wrap items-center gap-2">
              <DemoLabel />
              {step === 1 ? (
                <>
                  <Chip onClick={() => onScan(p.loc)}>{t("chip.rightShelf")} <code className="font-mono text-xs text-muted-foreground">{p.loc}</code></Chip>
                  {wrongLoc && <Chip bad onClick={() => onScan(wrongLoc.loc)}>{t("chip.wrongShelf")} <code className="font-mono text-xs">{wrongLoc.loc}</code></Chip>}
                </>
              ) : (
                <>
                  <Chip onClick={() => onScan(p.ean)}>{t("chip.rightItem")}</Chip>
                  {otherEan && <Chip bad onClick={() => onScan(otherEan)}>{sib ? t("chip.wrongVariant", { v: sib.variant }) : t("chip.wrongItem")}</Chip>}
                </>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-12 text-[15px] font-semibold" onClick={onDeviation}><AlertTriangle className="!h-4 !w-4" />{t("pick.dev")}</Button>
              <Button variant="outline" className="h-12 text-[15px] font-semibold" disabled={left < 2}
                onClick={() => { const n = lines.findIndex((l, k) => k > i && !lineDone(l)); setSel(n >= 0 ? n : lines.findIndex((l, k) => k !== i && !lineDone(l))) }}>
                {t("pick.next")}
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-6">
            <div className="flex items-center gap-2 text-3xl font-extrabold tracking-tight"><PackageCheck className="h-8 w-8 text-ok" />{t("pick.allDone")}</div>
            <Button className="mt-4 h-12 w-full text-base font-bold" onClick={onFinish}>{t("pick.review")}</Button>
          </div>
        )}

        <h2 className="mb-2 mt-7 text-[13px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{t("pick.list")}</h2>
        <div className="overflow-hidden rounded-md border bg-card">
          {lines.map((l, k) => {
            const q = products[l.sku]; const isDone = lineDone(l)
            return (
              <button key={l.id} disabled={isDone} onClick={() => { setSel(k); window.scrollTo({ top: 0, behavior: "smooth" }) }}
                className={cn("grid w-full items-center gap-2.5 border-t px-3 py-2.5 text-left first:border-t-0", multi ? "grid-cols-[98px_1fr_auto]" : "grid-cols-[72px_1fr_auto]",
                  k === i && "bg-warn-soft", isDone && "opacity-60")}>
                <span className={cn("flex items-center gap-1.5 text-lg font-extrabold tabular-nums", isDone && "line-through")}>{multi && <Box n={l.box} />}{q?.loc}</span>
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-semibold">{q?.name}</span>
                  <span className="block truncate text-muted-foreground">{q?.variant}</span>
                </span>
                <span className="text-[15px] font-bold tabular-nums">
                  {l.dev ? <span className="text-destructive">{t(`dev.${l.dev.kind}`)}</span> : isDone ? <span className="flex items-center gap-1 text-ok"><Check className="h-4 w-4" strokeWidth={3} />{l.picked}</span> : `${l.picked}/${l.qty}`}
                </span>
              </button>
            )
          })}
        </div>
        {line && <div className="mt-6 text-center"><button className="text-sm text-muted-foreground underline" onClick={onRelease}>{multi ? t("pick.releaseRound") : t("pick.release")}</button></div>}
      </main>
    </>
  )
}

/* ---------- Avvikelse ---------- */

function DeviationSheet({ open, onOpenChange, line, products, onSave }: {
  open: boolean; onOpenChange: (b: boolean) => void; line?: Line; products: Products
  onSave: (kind: DeviationKind, found: number, note: string, photo: Blob | null) => void
}) {
  const [kind, setKind] = useState<DeviationKind>("Saknas")
  const [found, setFound] = useState(0)
  const [note, setNote] = useState("")
  const [photo, setPhoto] = useState<Blob | null>(null)
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  useEffect(() => { if (open && line) { setKind("Saknas"); setFound(line.picked); setNote(""); setPhoto(null) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!line) return null
  const p = products[line.sku]
  const onFile = (f?: File) => {
    if (!f) return
    const img = new Image()
    img.onload = () => {
      const s = Math.min(1, 1024 / Math.max(img.width, img.height))
      const c = document.createElement("canvas"); c.width = img.width * s; c.height = img.height * s
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height)
      c.toBlob(b => setPhoto(b), "image/jpeg", 0.7); URL.revokeObjectURL(img.src)
    }
    img.src = URL.createObjectURL(f)
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92vh] max-w-xl overflow-auto rounded-t-xl pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <form className="grid gap-4" onSubmit={e => { e.preventDefault(); onSave(kind, found, note.trim(), photo) }}>
          <SheetHeader className="text-left">
            <SheetTitle className="text-2xl font-extrabold">{t("dev.title", { loc: p.loc })}</SheetTitle>
            <SheetDescription>{p.name}, {p.variant}</SheetDescription>
          </SheetHeader>
          <ToggleGroup type="single" value={kind} onValueChange={v => v && setKind(v as DeviationKind)} className="grid grid-cols-3 gap-1.5" aria-label={t("pick.dev")}>
            {DEVIATION_KINDS.map(k => (
              <ToggleGroupItem key={k} value={k} className="h-12 border font-semibold data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{t(`dev.${k}`)}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="grid gap-1.5">
            <span className="text-sm text-muted-foreground">{t("dev.found", { n: line.qty })}</span>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" className="h-12 w-12" aria-label={t("common.dec")} onClick={() => setFound(Math.max(0, found - 1))}><Minus /></Button>
              <output className="min-w-10 text-center text-3xl font-extrabold tabular-nums">{found}</output>
              <Button type="button" variant="outline" className="h-12 w-12" aria-label={t("common.inc")} onClick={() => setFound(Math.min(line.qty, found + 1))}><Plus /></Button>
            </div>
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm text-muted-foreground">{t("dev.photo")}</span>
            <div className="flex items-center gap-3">
              {preview && <img src={preview} alt={t("dev.photoAlt")} className="h-[72px] w-[72px] rounded object-cover" />}
              <label htmlFor="devphoto" className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border px-4 font-semibold"><Camera className="h-4 w-4" />{photo ? t("dev.retake") : t("dev.take")}</label>
              <input id="devphoto" type="file" accept="image/*" capture="environment" hidden onChange={e => onFile(e.target.files?.[0])} />
            </div>
          </div>
          <label className="grid gap-1.5" htmlFor="devnote">
            <span className="text-sm text-muted-foreground">{t("dev.note")}</span>
            <Textarea id="devnote" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder={t("dev.notePh")} className="text-base" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-12 font-semibold" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
            <Button type="submit" className="h-12 font-bold">{t("dev.save")}</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

/* ---------- Klar ---------- */

function Done({ r, products, onBack, onSend }: { r: Round; products: Products; onBack: () => void; onSend: () => void }) {
  const multi = r.orders.length > 1
  const devs = r.lines.filter(l => l.dev)
  const start = Math.min(...r.orders.map(o => o.startedAt || Date.now()))
  const rows: [string, string][] = [
    ...(multi ? [] : [[t("done.order"), `#${r.orders[0].id}`], [t("done.cust"), r.orders[0].cust]] as [string, string][]),
    [t("done.kolli"), t("done.of", { a: r.lines.reduce((n, l) => n + l.picked, 0), b: r.orders.reduce((n, o) => n + kolli(o), 0) })],
    [t("done.picker"), r.orders[0].picker || ""], [t("done.time"), t("common.min", { n: mins(Date.now() - start) })],
    ...(multi ? [] : [[t("done.ship"), t("done.shipVal", { txt: r.orders[0].shipTxt, due: r.orders[0].due })]] as [string, string][]),
  ]
  return (
    <>
      <Header><Button variant="ghost" className="-ml-3 h-10 px-2 text-base font-semibold" onClick={onBack}><ChevronLeft className="!h-5 !w-5" />{t("done.back")}</Button></Header>
      <main className="mx-auto max-w-xl px-4 pb-36">
        <h1 className="mt-6 text-[34px] font-extrabold leading-tight tracking-tight">{devs.length ? t("done.dev") : t("done.ok")}</h1>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border bg-card p-4 tabular-nums">
          {rows.map(([k, v]) => (<Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="m-0 text-right font-semibold">{v}</dd></Fragment>))}
        </dl>
        {multi && (
          <div className="mt-3 overflow-hidden rounded-md border bg-card">
            {r.orders.map((o, k) => (
              <div key={o.id} className="flex items-center gap-3 border-t px-4 py-2.5 text-sm first:border-t-0">
                <Box n={k + 1} />
                <span className="min-w-0 flex-1"><b className="font-mono">#{o.id}</b> {o.cust}<span className="block text-muted-foreground">{t("done.shipVal", { txt: o.shipTxt, due: o.due })}</span></span>
                <span className={cn("font-semibold tabular-nums", o.lines.some(l => l.dev) && "text-destructive")}>{o.lines.reduce((n, l) => n + l.picked, 0)}/{kolli(o)}</span>
              </div>
            ))}
          </div>
        )}
        {devs.length > 0 && (
          <div className="mt-3 grid gap-2">
            {devs.map(l => { const p = products[l.sku]; return (
              <div key={l.id} className="flex items-center gap-3 rounded-md bg-bad-soft p-3 text-sm">
                {l.dev!.photo && <img src={l.dev!.photo} alt="" className="h-14 w-14 rounded object-cover" />}
                <div><b className="text-destructive">{t(`dev.${l.dev!.kind}`)}</b> · {multi && `#${l.orderId} · `}{p.loc} · {p.name}, {p.variant}<br />{t("done.found", { a: l.dev!.found, b: l.qty })}{l.dev!.note && ` · ${l.dev!.note}`}</div>
              </div>) })}
          </div>
        )}
        <Button className="mt-5 h-12 w-full bg-ok text-base font-bold text-white hover:bg-ok/90" onClick={onSend}>{multi ? t("done.sendMany", { n: r.orders.length }) : t("done.send")}</Button>
      </main>
    </>
  )
}
