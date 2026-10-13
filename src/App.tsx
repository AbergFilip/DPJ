import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { AlertTriangle, Camera, Check, ChevronLeft, Clock, Keyboard, Lock, Minus, PackageCheck, Plus, ScanLine, Truck, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import {
  DEVIATION_KINDS, kolli, lineDone, mins, sortByLoc,
  type DeviationKind, type Line, type Order, type ProductType, type Products, type Snapshot, type Status,
} from "./data"
import { createStore } from "./store"
import { ROLE_LABEL, currentUser, logout, type User } from "./auth"
import Login, { Logo } from "./Login"

const store = createStore()
// Kameraskannern (zxing) är stor, så den laddas först när någon trycker på kameraknappen.
const CameraScanner = lazy(() => import("./CameraScanner"))

type View = { name: "queue" } | { name: "pick"; id: string } | { name: "done"; id: string }
type FlashKind = "ok" | "err" | "warn"
interface Flash { kind: FlashKind; title: string; sub?: string; sticky?: boolean; n: number }

const STATUS: Record<Status, { label: string; cls: string }> = {
  ny: { label: "Ny", cls: "bg-secondary text-secondary-foreground" },
  plock: { label: "Plockas", cls: "bg-warn-soft text-warn" },
  pack: { label: "Klar för pack", cls: "bg-ok-soft text-ok" },
  avv: { label: "Avvikelse", cls: "bg-bad-soft text-destructive" },
}

const ICON: Record<ProductType, string> = {
  skiva: '<path d="M4 22 L30 14 L44 20 L18 28 Z"/><path d="M4 22 v4 L18 32 v-4 M18 32 L44 24 v-4"/>',
  stativ: '<path d="M8 12 H40 M14 12 V36 M34 12 V36 M8 36 H20 M28 36 H40"/>',
  hurts: '<rect x="12" y="6" width="24" height="34" rx="2"/><path d="M12 17 H36 M12 28 H36 M21 11.5 h6 M21 22.5 h6 M21 33.5 h6"/>',
  stol: '<path d="M16 6 h16 v16 H16 Z M12 26 H36 M24 26 V36 M14 42 L24 36 L34 42"/>',
  vagg: '<rect x="6" y="10" width="36" height="20" rx="3"/><path d="M14 30 v8 M34 30 v8 M10 38 h8 M30 38 h8"/>',
  arm: '<rect x="4" y="8" width="16" height="11" rx="1"/><rect x="28" y="8" width="16" height="11" rx="1"/><path d="M12 19 L24 26 L36 19 M24 26 V42 M18 42 H30"/>',
  ranna: '<path d="M4 18 L4 28 L44 28 L44 18 M4 28 L10 32 L44 32 L44 28"/>',
  fot: '<path d="M6 32 L40 22 L42 28 L8 38 Z M14 36 v4 M34 26 v8"/>',
}
const Pict = ({ type, className }: { type: ProductType; className?: string }) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
    className={className} dangerouslySetInnerHTML={{ __html: ICON[type] ?? "" }} aria-hidden="true" />
)

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

function currentLine(o: Order, products: Products, sel: number | null) {
  const lines = sortByLoc(o.lines, products)
  const i = sel != null && lines[sel] && !lineDone(lines[sel]) ? sel : lines.findIndex(l => !lineDone(l))
  return { lines, i, line: i >= 0 ? lines[i] : undefined as Line | undefined }
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
  const busy = useRef(false)

  useEffect(() => store.subscribe(setSnap, msg => say("err", "Kunde inte nå databasen", msg, true)), [])
  useEffect(() => {
    if (!flash || flash.sticky) return
    const t = setTimeout(() => setFlash(null), 1700)
    return () => clearTimeout(t)
  }, [flash])

  function say(kind: FlashKind, title: string, sub?: string, sticky?: boolean) { setFlash({ kind, title, sub, sticky, n: Date.now() }); feedback(kind) }
  const go = (v: View) => { setView(v); setSel(null); window.scrollTo(0, 0) }
  const once = async (fn: () => Promise<void>) => {
    if (busy.current) return
    busy.current = true
    try { await fn() } catch { /* felet visas via onError */ } finally { busy.current = false }
  }

  if (!snap) return <div className="grid min-h-screen place-items-center text-muted-foreground">Hämtar order…</div>
  const { products, orders } = snap
  const order = view.name !== "queue" ? orders.find(o => o.id === view.id) : undefined

  async function handleScan(raw: string) {
    if (!order) return
    const code = raw.trim().toUpperCase()
    if (!code) return
    const { line: l } = currentLine(order, products, sel)
    if (!l) return
    const p = products[l.sku]
    const byEan = Object.values(products).find(q => q.ean === code)
    const byLoc = Object.values(products).find(q => q.loc === code)
    const bump = () => setShakeN(n => n + 1)
    if (!l.locOk) {
      if (code === p.loc) {
        await once(async () => { if (await store.confirmLocation(l.id, me)) say("ok", `Rätt hylla ${p.loc}`, "Skanna varan.") })
      } else if (byLoc) { say("warn", `Fel hylla: ${code}`, `Gå till ${p.loc}.`); bump() }
      else if (byEan) { say("warn", "Skanna hyllan först", `Hyllplats ${p.loc}.`); bump() }
      else { say("warn", "Okänd kod", code); bump() }
      return
    }
    if (code === p.ean) {
      await once(async () => {
        const n = await store.pickItem(l.id, me)
        if (n == null) return
        if (n >= l.qty) {
          setSel(null)
          const next = currentLine({ ...order, lines: order.lines.map(x => x.id === l.id ? { ...x, picked: n } : x) }, products, null).line
          say("ok", `Rad klar: ${l.qty} st`, next ? `Nästa: ${products[next.sku].loc}` : "Alla rader plockade.")
        } else say("ok", `${n} av ${l.qty}`, `Skanna ${l.qty - n} till.`)
      })
    } else if (byEan) {
      say("err", "Fel vara, lägg tillbaka", `Du skannade ${byEan.name}, ${byEan.variant}. Ska vara ${p.variant}.`, true); bump()
    } else if (byLoc) say("warn", "Hyllan är redan skannad", "Skanna varans streckkod.")
    else { say("warn", "Okänd kod", code); bump() }
  }

  return (
    <div className="min-h-full">
      <FlashBanner flash={flash} onClose={() => setFlash(null)} />
      {view.name === "queue" && (
        <Queue orders={orders} user={user} onLogout={onLogout}
          onStart={id => once(async () => {
            if (await store.claim(id, me)) go({ name: "pick", id })
            else say("warn", "Ordern är redan tagen", "Någon annan hann före, eller så har du en order igång.")
          })}
          onOpen={id => go({ name: "pick", id })}
          onReset={() => once(async () => { await store.reset(); say("ok", "Demodata återställd") })} />
      )}
      {view.name !== "queue" && !order && <p className="p-6 text-muted-foreground">Ordern finns inte längre. <button className="underline" onClick={() => go({ name: "queue" })}>Till kön</button></p>}
      {view.name === "pick" && order && (
        <>
          <Pick o={order} products={products} sel={sel} setSel={setSel} shakeN={shakeN}
            onBack={() => go({ name: "queue" })}
            onScan={handleScan}
            onNoCamera={() => say("warn", "Kameran gick inte att starta", "Tillåt kameran i webbläsaren, eller använd handskanner.", true)}
            onDeviation={() => setDevOpen(true)}
            onFinish={() => go({ name: "done", id: order.id })}
            onRelease={() => once(async () => { await store.release(order.id, me); say("ok", `#${order.id} släppt`, "Ordern ligger i kön igen."); go({ name: "queue" }) })} />
          <DeviationSheet open={devOpen} onOpenChange={setDevOpen} line={currentLine(order, products, sel).line} products={products}
            onSave={(kind, found, note, photo) => once(async () => {
              const l = currentLine(order, products, sel).line
              if (!l) return
              await store.reportDeviation(l.id, me, kind, found, note, photo)
              setSel(null); setDevOpen(false)
              say("warn", `Raden flaggad: ${kind}`, "Ordern markeras med avvikelse.")
            })} />
        </>
      )}
      {view.name === "done" && order && (
        <Done o={order} products={products} onBack={() => setView({ name: "pick", id: order.id })}
          onSend={() => once(async () => {
            const s = await store.finish(order.id, me)
            if (!s) { say("warn", "Ordern kunde inte skickas", "Kontrollera att alla rader är klara."); return }
            say("ok", `#${order.id} skickad till pack`, s === "avv" ? "Avvikelsen syns för pack och inköp." : "Bra jobbat.")
            go({ name: "queue" })
          })} />
      )}
    </div>
  )
}

/* ---------- Delar ---------- */

function UspStrip() {
  const items = ["Lagervaror skickas inom 24h", "Express före kl. 12", "Varje kolli skannas"]
  return (
    <div className="bg-strip text-[13px] font-medium text-strip-foreground">
      <div className="mx-auto flex max-w-xl items-center justify-between gap-3 overflow-hidden px-4 py-1.5">
        {items.map((t, k) => (
          <span key={t} className={cn("flex items-center gap-1.5 whitespace-nowrap", k === 2 && "hidden sm:flex")}>
            <Check className="h-3.5 w-3.5" strokeWidth={3} />{t}
          </span>
        ))}
      </div>
    </div>
  )
}

function Header({ children }: { children: ReactNode }) {
  return (
    <header className="sticky top-[env(safe-area-inset-top,0px)] z-30 border-b bg-header">
      <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">{children}</div>
    </header>
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
  return <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide", STATUS[s].cls)}>{STATUS[s].label}</span>
}
function ShipBadge({ o }: { o: Order }) {
  return o.ship === "exp"
    ? <Badge className="gap-1 rounded bg-strip text-strip-foreground shadow-none hover:bg-strip"><Zap className="h-3 w-3" />Express</Badge>
    : <Badge variant="outline" className="gap-1 rounded"><Truck className="h-3 w-3" />PostNord</Badge>
}

/* ---------- Orderkö ---------- */

function Queue({ orders, user, onLogout, onStart, onOpen, onReset }: {
  orders: Order[]; user: User; onLogout: () => void; onStart: (id: string) => void; onOpen: (id: string) => void; onReset: () => void
}) {
  const me = user.name
  const rank = (o: Order) => ({ plock: 0, ny: 1, avv: 2, pack: 3 }[o.status] * 10 + (o.ship === "exp" ? 0 : 5))
  const list = [...orders].sort((a, b) => rank(a) - rank(b) || a.due.localeCompare(b.due))
  const cnt = (k: Status) => orders.filter(o => o.status === k).length
  const active = orders.find(o => o.status === "plock" && o.picker === me)
  const groups: [string, Order[]][] = [
    ["Pågår", list.filter(o => o.status === "plock")],
    ["Orderkö i dag", list.filter(o => o.status === "ny")],
    ["Plockade", list.filter(o => o.status === "pack" || o.status === "avv")],
  ]
  return (
    <>
      <UspStrip />
      <Header>
        <Logo />
        <span className="ml-1 rounded bg-primary px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-primary-foreground">Plock</span>
        <div className="flex-1" />
        <div className="text-right leading-tight">
          <div className="font-semibold">{me}</div>
          <button className="text-xs text-muted-foreground underline" onClick={onLogout}>Logga ut</button>
        </div>
      </Header>
      <main className="mx-auto max-w-xl px-4 pb-24">
        <div className="mt-5 flex items-baseline gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Hej {me}!</h1>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{ROLE_LABEL[user.role]}</span>
          <span className={cn("ml-auto flex items-center gap-1.5 text-xs font-semibold", store.mode === "supabase" ? "text-ok" : "text-muted-foreground")}>
            <span className={cn("h-2 w-2 rounded-full", store.mode === "supabase" ? "bg-ok" : "bg-muted-foreground")} />
            {store.mode === "supabase" ? "Live, delas med alla" : "Lokal demo"}
          </span>
        </div>
        <p className="text-muted-foreground">{cnt("ny")} order väntar på plock i dag.</p>
        <div className="mt-4 grid grid-cols-4 gap-2">
          {([["ny", "Att plocka"], ["plock", "Plockas nu"], ["avv", "Avvikelse"], ["pack", "Till pack"]] as [Status, string][]).map(([k, t]) => (
            <div key={k} className="rounded-md border bg-card px-2.5 py-2">
              <div className={cn("text-2xl font-extrabold leading-none tabular-nums", k === "avv" && cnt(k) > 0 && "text-destructive")}>{cnt(k)}</div>
              <div className="mt-1 text-[11px] font-medium leading-tight text-muted-foreground">{t}</div>
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
                return (
                  <article key={o.id} className={cn("rounded-md border bg-card p-3.5", mine && "border-primary ring-1 ring-primary")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <ShipBadge o={o} />
                      <span className="font-mono text-[13px] text-muted-foreground">#{o.id}</span>
                    </div>
                    <div className="mt-1.5 font-semibold text-card-foreground">{o.cust}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Ut senast {o.due}</span>
                      <span>{o.lines.length} rader · {kolli(o)} kolli</span>
                      {o.status === "plock" && <span>{doneRows}/{o.lines.length} klara</span>}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <Pill s={o.status} />
                      <div className="flex-1" />
                      {o.status === "ny" && <Button className="h-11 px-5 text-[15px] font-bold" disabled={!!active} onClick={() => onStart(o.id)}>Starta plock</Button>}
                      {mine && <Button className="h-11 px-5 text-[15px] font-bold" onClick={() => onOpen(o.id)}>Fortsätt</Button>}
                      {o.status === "plock" && !mine && <span className="flex items-center gap-1 text-sm text-muted-foreground"><Lock className="h-3.5 w-3.5" />Låst av {o.picker}</span>}
                      {(o.status === "pack" || o.status === "avv") && o.doneAt && o.startedAt && <span className="text-sm text-muted-foreground">{o.picker} · {mins(o.doneAt - o.startedAt)} min</span>}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))}
        {active && <p className="mt-4 text-sm text-muted-foreground">Du har en order igång. Avsluta eller släpp den innan du tar nästa.</p>}
        <p className="mt-8 rounded-md bg-muted px-3 py-2 text-[13px] text-muted-foreground">Demo med påhittade order och artiklar. Inget här kommer från DPJ:s system.</p>
        <div className="mt-3 flex justify-center gap-5">
          <a className="text-sm text-muted-foreground underline" href="/etiketter.html">Streckkoder för demo</a>
          {user.role === "ledare" && <a className="text-sm text-muted-foreground underline" href="/admin.html">Översikt</a>}
          <button className="text-sm text-muted-foreground underline" onClick={onReset}>Återställ demodata</button>
        </div>
      </main>
    </>
  )
}

/* ---------- Plock ---------- */

function Pick({ o, products, sel, setSel, shakeN, onBack, onScan, onNoCamera, onDeviation, onFinish, onRelease }: {
  o: Order; products: Products; sel: number | null; setSel: (n: number | null) => void; shakeN: number
  onBack: () => void; onScan: (c: string) => void; onNoCamera: () => void; onDeviation: () => void; onFinish: () => void; onRelease: () => void
}) {
  const { lines, i, line } = currentLine(o, products, sel)
  const done = lines.filter(lineDone).length
  const [code, setCode] = useState("")
  const [typing, setTyping] = useState(false)
  const [camera, setCamera] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const curRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!camera) inputRef.current?.focus({ preventScroll: true }) }, [i, line?.locOk, line?.picked, camera])
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
        <Button variant="ghost" className="-ml-3 h-10 px-2 text-base font-semibold" onClick={onBack}><ChevronLeft className="!h-5 !w-5" />Kö</Button>
        <div className="flex-1" />
        <div className="min-w-0 text-right">
          <div className="font-mono text-sm">#{o.id}</div>
          <div className="truncate text-[13px] text-muted-foreground">{o.cust}</div>
        </div>
      </Header>
      <main className="mx-auto max-w-xl px-4 pb-24">
        <div className="mt-4 flex justify-between text-sm tabular-nums text-muted-foreground">
          <span>{done} av {lines.length} rader</span>
          <span className="flex items-center gap-1.5"><ShipBadge o={o} />ut {o.due}</span>
        </div>
        <Progress value={done / Math.max(1, lines.length) * 100} className="mt-2 h-2 bg-secondary [&>div]:bg-ok" />

        {line && p ? (
          <>
            <div ref={curRef} className="mt-4 overflow-hidden rounded-md border bg-card">
              <div className={cn("flex", line.locOk ? "bg-ok text-white" : "bg-sign text-sign-foreground")}>
                <div className="flex-1 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-75">Hyllplats{line.locOk && " · bekräftad"}</div>
                  <div className="text-[52px] font-extrabold leading-none tracking-tight tabular-nums">
                    <span className={line.locOk ? "" : "text-sign-accent"}>{p.loc.split("-")[0]}</span>-{p.loc.split("-").slice(1).join("-")}
                  </div>
                </div>
                <div className="border-l border-white/20 px-4 py-3 text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-75">Antal</div>
                  <div className="text-[46px] font-extrabold leading-none tabular-nums">{line.qty}</div>
                </div>
              </div>
              <div className="flex items-center gap-3.5 px-4 py-3.5">
                <div className="grid h-16 w-16 shrink-0 place-items-center rounded bg-muted text-muted-foreground"><Pict type={p.type} className="h-11 w-11" /></div>
                <div className="min-w-0">
                  {p.brand && <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{p.brand}</div>}
                  <div className="text-lg font-bold leading-tight text-card-foreground">{p.name}</div>
                  <div className="mt-1"><span className="rounded bg-accent px-1.5 py-0.5 text-[16px] font-bold text-accent-foreground">{p.variant}</span></div>
                  <div className="mt-1.5 break-all font-mono text-xs text-muted-foreground">{line.sku} · EAN {p.ean}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 border-t text-sm">
                <div className={cn("flex items-center gap-2 px-4 py-2.5", step === 1 ? "bg-warn-soft font-bold text-foreground" : "text-muted-foreground")}>
                  <span className={cn("grid h-6 w-6 place-items-center rounded-full border-2 text-xs font-bold", step === 1 ? "border-warn text-warn" : "border-ok bg-ok text-white")}>{step === 1 ? "1" : <Check className="h-3.5 w-3.5" strokeWidth={3} />}</span>
                  Skanna hyllan
                </div>
                <div className={cn("flex items-center gap-2 border-l px-4 py-2.5", step === 2 ? "bg-warn-soft font-bold text-foreground" : "text-muted-foreground")}>
                  <span className={cn("grid h-6 w-6 place-items-center rounded-full border-2 text-xs font-bold", step === 2 ? "border-warn text-warn" : "border-border")}>2</span>
                  Skanna varan
                  {step === 2 && <span className="ml-auto text-lg font-extrabold tabular-nums">{line.picked}/{line.qty}</span>}
                </div>
              </div>
            </div>

            <form className="mt-3 flex gap-2" autoComplete="off" onSubmit={e => { e.preventDefault(); onScan(code); setCode("") }}>
              <div className="relative min-w-0 flex-1">
                <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <input ref={inputRef} id="scan" value={code} onChange={e => setCode(e.target.value)} inputMode={typing ? "text" : "none"}
                  placeholder={step === 1 ? "Skanna hylletikett" : "Skanna varans streckkod"} aria-label="Skannad kod"
                  className="h-12 w-full rounded-md border-2 border-dashed border-input bg-card pl-10 pr-3 font-mono text-base text-card-foreground outline-none focus:border-solid focus:border-ring" />
              </div>
              {!!navigator.mediaDevices?.getUserMedia && (
                <Button type="button" className="h-12 px-4" onClick={() => setCamera(true)} aria-label="Skanna med kameran"><Camera className="!h-5 !w-5" /></Button>
              )}
              <Button type="button" variant="outline" className="h-12" aria-label="Skriv in kod" onClick={() => { setTyping(true); setTimeout(() => inputRef.current?.focus(), 0) }}><Keyboard className="!h-5 !w-5" /></Button>
            </form>

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-muted-foreground">Testa:</span>
              {step === 1 ? (
                <>
                  <Chip onClick={() => onScan(p.loc)}>Rätt hylla <code className="font-mono text-xs text-muted-foreground">{p.loc}</code></Chip>
                  {wrongLoc && <Chip bad onClick={() => onScan(wrongLoc.loc)}>Fel hylla <code className="font-mono text-xs">{wrongLoc.loc}</code></Chip>}
                </>
              ) : (
                <>
                  <Chip onClick={() => onScan(p.ean)}>Rätt vara</Chip>
                  {otherEan && <Chip bad onClick={() => onScan(otherEan)}>{sib ? `Fel variant: ${sib.variant}` : "Fel vara"}</Chip>}
                </>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-12 text-[15px] font-semibold" onClick={onDeviation}><AlertTriangle className="!h-4 !w-4" />Avvikelse</Button>
              <Button variant="outline" className="h-12 text-[15px] font-semibold" disabled={left < 2}
                onClick={() => { const n = lines.findIndex((l, k) => k > i && !lineDone(l)); setSel(n >= 0 ? n : lines.findIndex((l, k) => k !== i && !lineDone(l))) }}>
                Ta nästa rad
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-6">
            <div className="flex items-center gap-2 text-3xl font-extrabold tracking-tight"><PackageCheck className="h-8 w-8 text-ok" />Alla rader är plockade</div>
            <Button className="mt-4 h-12 w-full text-base font-bold" onClick={onFinish}>Granska och skicka till pack</Button>
          </div>
        )}

        <h2 className="mb-2 mt-7 text-[13px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Plocklista i gångordning</h2>
        <div className="overflow-hidden rounded-md border bg-card">
          {lines.map((l, k) => {
            const q = products[l.sku]; const isDone = lineDone(l)
            return (
              <button key={l.id} disabled={isDone} onClick={() => { setSel(k); window.scrollTo({ top: 0, behavior: "smooth" }) }}
                className={cn("grid w-full grid-cols-[72px_1fr_auto] items-center gap-2.5 border-t px-3 py-2.5 text-left first:border-t-0",
                  k === i && "bg-warn-soft", isDone && "opacity-60")}>
                <span className={cn("text-lg font-extrabold tabular-nums", isDone && "line-through")}>{q?.loc}</span>
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-semibold">{q?.name}</span>
                  <span className="block truncate text-muted-foreground">{q?.variant}</span>
                </span>
                <span className="text-[15px] font-bold tabular-nums">
                  {l.dev ? <span className="text-destructive">{l.dev.kind}</span> : isDone ? <span className="flex items-center gap-1 text-ok"><Check className="h-4 w-4" strokeWidth={3} />{l.picked}</span> : `${l.picked}/${l.qty}`}
                </span>
              </button>
            )
          })}
        </div>
        {line && <div className="mt-6 text-center"><button className="text-sm text-muted-foreground underline" onClick={onRelease}>Släpp ordern tillbaka till kön</button></div>}
      </main>
      {camera && <Suspense fallback={<div className="fixed inset-0 z-[70] bg-black" />}><CameraScanner onClose={() => setCamera(false)} onFail={() => { setCamera(false); onNoCamera() }}
        onCode={c => { setCamera(false); onScan(c) }} hint={step === 1 ? "Rikta mot hylletiketten" : "Rikta mot varans streckkod"} /></Suspense>}
    </>
  )
}

function Chip({ children, bad, onClick }: { children: ReactNode; bad?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-2 text-sm font-semibold",
      bad ? "border-destructive text-destructive" : "text-card-foreground")}>{children}</button>
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
            <SheetTitle className="text-2xl font-extrabold">Avvikelse på {p.loc}</SheetTitle>
            <SheetDescription>{p.name}, {p.variant}</SheetDescription>
          </SheetHeader>
          <ToggleGroup type="single" value={kind} onValueChange={v => v && setKind(v as DeviationKind)} className="grid grid-cols-3 gap-1.5" aria-label="Typ av avvikelse">
            {DEVIATION_KINDS.map(k => (
              <ToggleGroupItem key={k} value={k} className="h-12 border font-semibold data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{k}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="grid gap-1.5">
            <span className="text-sm text-muted-foreground">Hittade antal (av {line.qty})</span>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" className="h-12 w-12" aria-label="Minska" onClick={() => setFound(Math.max(0, found - 1))}><Minus /></Button>
              <output className="min-w-10 text-center text-3xl font-extrabold tabular-nums">{found}</output>
              <Button type="button" variant="outline" className="h-12 w-12" aria-label="Öka" onClick={() => setFound(Math.min(line.qty, found + 1))}><Plus /></Button>
            </div>
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm text-muted-foreground">Foto</span>
            <div className="flex items-center gap-3">
              {preview && <img src={preview} alt="Foto på avvikelsen" className="h-[72px] w-[72px] rounded object-cover" />}
              <label htmlFor="devphoto" className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border px-4 font-semibold"><Camera className="h-4 w-4" />{photo ? "Ta nytt foto" : "Ta foto"}</label>
              <input id="devphoto" type="file" accept="image/*" capture="environment" hidden onChange={e => onFile(e.target.files?.[0])} />
            </div>
          </div>
          <label className="grid gap-1.5" htmlFor="devnote">
            <span className="text-sm text-muted-foreground">Kommentar</span>
            <Textarea id="devnote" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="T.ex. tom plats, trasig kartong" className="text-base" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-12 font-semibold" onClick={() => onOpenChange(false)}>Avbryt</Button>
            <Button type="submit" className="h-12 font-bold">Flagga raden</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

/* ---------- Klar ---------- */

function Done({ o, products, onBack, onSend }: { o: Order; products: Products; onBack: () => void; onSend: () => void }) {
  const devs = o.lines.filter(l => l.dev)
  const rows: [string, string][] = [
    ["Order", `#${o.id}`], ["Kund", o.cust],
    ["Kolli plockade", `${o.lines.reduce((n, l) => n + l.picked, 0)} av ${kolli(o)}`],
    ["Plockare", o.picker || ""], ["Tid", `${mins(Date.now() - (o.startedAt || Date.now()))} min`],
    ["Leverans", `${o.shipTxt}, ut ${o.due}`],
  ]
  return (
    <>
      <Header><Button variant="ghost" className="-ml-3 h-10 px-2 text-base font-semibold" onClick={onBack}><ChevronLeft className="!h-5 !w-5" />Plocklista</Button></Header>
      <main className="mx-auto max-w-xl px-4 pb-24">
        <h1 className="mt-6 text-[34px] font-extrabold leading-tight tracking-tight">{devs.length ? "Plockad med avvikelse" : "Komplett plockad"}</h1>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border bg-card p-4 tabular-nums">
          {rows.map(([k, v]) => (<Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="m-0 text-right font-semibold">{v}</dd></Fragment>))}
        </dl>
        {devs.length > 0 && (
          <div className="mt-3 grid gap-2">
            {devs.map(l => { const p = products[l.sku]; return (
              <div key={l.id} className="flex items-center gap-3 rounded-md bg-bad-soft p-3 text-sm">
                {l.dev!.photo && <img src={l.dev!.photo} alt="" className="h-14 w-14 rounded object-cover" />}
                <div><b className="text-destructive">{l.dev!.kind}</b> · {p.loc} · {p.name}, {p.variant}<br />Hittade {l.dev!.found} av {l.qty}{l.dev!.note && ` · ${l.dev!.note}`}</div>
              </div>) })}
          </div>
        )}
        <Button className="mt-5 h-12 w-full bg-ok text-base font-bold text-white hover:bg-ok/90" onClick={onSend}>Skicka till pack</Button>
      </main>
    </>
  )
}
