// Översikt för arbetsledaren på datorn: hela kön live, vem som plockar vad, tider och avvikelser med foto.
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { AlertTriangle, ArrowLeft, Camera, Clock, LogOut, PackageCheck, Timer, TrendingDown, Truck, Users, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { kolli, lineDone, mins, sortByLoc, type Order, type Snapshot, type Status, type StockMove } from "./data"
import { createStore } from "./store"
import { USERS, currentUser, logout, type User } from "./auth"
import Login, { Avatar, Logo } from "./Login"
import ImportPanel from "./ImportPanel"
import { refillRows, stockRows } from "./Lager"
import { DAY_END, DAY_START, errorsPerWeek, picksPerHour } from "./stats"
import { Button } from "@/components/ui/button"

const store = createStore()

const STATUS: Record<Status, { label: string; cls: string }> = {
  ny: { label: "Ny", cls: "bg-secondary text-secondary-foreground" },
  plock: { label: "Plockas", cls: "bg-warn-soft text-warn" },
  pack: { label: "Klar för pack", cls: "bg-ok-soft text-ok" },
  avv: { label: "Avvikelse", cls: "bg-bad-soft text-destructive" },
  skickad: { label: "Skickad", cls: "bg-secondary text-secondary-foreground" },
}
const MOVE = { in: "Inleverans", plock: "Plock", avvikelse: "Avvikelse", inventering: "Inventering" }
const ORDER: Record<Status, number> = { plock: 0, ny: 1, avv: 2, pack: 3, skickad: 4 }

const dueAt = (o: Order) => { const [h, m] = o.due.split(":").map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime() }
const isLate = (o: Order, now: number) => (o.status === "ny" || o.status === "plock") && now > dueAt(o)
const picked = (o: Order) => o.lines.reduce((n, l) => n + l.picked, 0)
const pickTime = (o: Order) => (o.startedAt && o.doneAt ? o.doneAt - o.startedAt : null)
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const clock = (ms: number) => new Date(ms).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })

function Kpi({ icon, label, value, sub, tone }: { icon: ReactNode; label: string; value: ReactNode; sub?: string; tone?: "ok" | "bad" | "warn" }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg",
          tone === "ok" ? "bg-ok-soft text-ok" : tone === "bad" ? "bg-bad-soft text-destructive" : tone === "warn" ? "bg-warn-soft text-warn" : "bg-secondary text-secondary-foreground")}>{icon}</span>
        <span className="text-xs font-bold uppercase leading-tight tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className={cn("mt-3 text-3xl font-extrabold tabular-nums tracking-tight",
        tone === "ok" && "text-ok", tone === "bad" && "text-destructive", tone === "warn" && "text-warn")}>{value}</div>
      {sub && <div className="mt-0.5 text-sm text-muted-foreground">{sub}</div>}
    </div>
  )
}

const Section = ({ id, title, children, right }: { id?: string; title: string; children: ReactNode; right?: ReactNode }) => (
  <section id={id} className="min-w-0 scroll-mt-20 overflow-hidden rounded-xl border bg-card shadow-sm">
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3"><h2 className="flex-1 font-bold tracking-tight">{title}</h2>{right}</div>
    {children}
  </section>
)

/* ---------- Statistik över tid ---------- */

// Staplar per timme. Timmar som fyllts med demohistorik ritas ljusare och märks ut under grafen.
function HourChart({ moves, now }: { moves: StockMove[]; now: number }) {
  const bars = picksPerHour(moves, now)
  const max = Math.max(10, ...bars.map(b => b.picks))
  const total = bars.reduce((n, b) => n + b.picks, 0)
  const best = bars.reduce((a, b) => (b.picks > a.picks ? b : a), bars[0])
  const hourNow = new Date(now).getHours()
  return (
    <div className="p-4">
      <div className="flex flex-wrap items-baseline gap-x-4 text-sm text-muted-foreground">
        <span><b className="text-2xl font-extrabold tabular-nums text-foreground">{total}</b> kolli i dag</span>
        <span>snitt {Math.round(total / bars.length)} per timme</span>
        {best.picks > 0 && <span>bäst kl {best.hour}: {best.picks}</span>}
      </div>
      <div className="mt-4 flex h-40 items-stretch gap-1.5">
        {bars.map(b => (
          <div key={b.hour} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[11px] font-bold tabular-nums text-muted-foreground">{b.picks || ""}</span>
            <div className={cn("w-full rounded-t", b.hour === hourNow ? "bg-primary" : b.demo ? "bg-secondary" : "bg-ok")}
              style={{ height: `${Math.max(2, (b.picks / max) * 85)}%` }}
              title={`Kl ${b.hour}: ${b.picks} kolli${b.demo ? " (demohistorik)" : ""}`} />
            <span className="text-[11px] tabular-nums text-muted-foreground">{b.hour}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Kl {DAY_START}–{DAY_END}. Grönt är plock som gjorts i demon, grått är påhittad historik för timmar som redan passerat.
      </p>
    </div>
  )
}

// Felrate per vecka: andel order med avvikelse.
function WeekChart({ orders, now }: { orders: Order[]; now: number }) {
  const weeks = errorsPerWeek(orders, now)
  const max = Math.max(2, ...weeks.map(w => w.rate))
  const last = weeks[weeks.length - 1]
  const prev = weeks[weeks.length - 2]
  const trend = prev ? Math.round((last.rate - prev.rate) * 10) / 10 : 0
  return (
    <div className="p-4">
      <div className="flex flex-wrap items-baseline gap-x-4 text-sm text-muted-foreground">
        <span><b className={cn("text-2xl font-extrabold tabular-nums", last.rate > 5 ? "text-destructive" : "text-foreground")}>{last.rate} %</b> den här veckan</span>
        <span>{last.devs} av {last.orders} order</span>
        {prev && <span className={cn("font-semibold", trend > 0 ? "text-destructive" : "text-ok")}>{trend > 0 ? "+" : ""}{trend} mot förra veckan</span>}
      </div>
      <div className="mt-4 flex h-40 items-stretch gap-2">
        {weeks.map(w => (
          <div key={w.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[11px] font-bold tabular-nums text-muted-foreground">{w.rate}</span>
            <div className={cn("w-full rounded-t", w.demo ? "bg-secondary" : w.rate > 5 ? "bg-destructive" : "bg-ok")}
              style={{ height: `${Math.max(2, (w.rate / max) * 85)}%` }}
              title={`${w.label}: ${w.devs} av ${w.orders} order med avvikelse${w.demo ? " (demohistorik)" : ""}`} />
            <span className="truncate text-[11px] tabular-nums text-muted-foreground">{w.label}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Andel plockade order med avvikelse. Sista stapeln är demons egna order, de grå är påhittad historik.</p>
    </div>
  )
}

export default function Admin() {
  const [user, setUser] = useState<User | null>(currentUser)
  const out = () => { logout(); setUser(null) }
  if (!user) return <Login only="ledare" title="Logga in som arbetsledare" onLogin={setUser} />
  if (user.role !== "ledare") return (
    <div className="mx-auto max-w-sm px-4 py-10">
      <Logo />
      <h1 className="mt-8 text-2xl font-extrabold">Bara för arbetsledare</h1>
      <p className="mt-2 text-muted-foreground">Du är inloggad som {user.name}, som är plockare. Översikten visas bara för arbetsledare.</p>
      <div className="mt-6 flex gap-2">
        <Button onClick={out}>Byt användare</Button>
        <Button variant="outline" asChild><a href="/">Till plockappen</a></Button>
      </div>
    </div>
  )
  return <Overview user={user} onLogout={out} />
}

function Overview({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [filter, setFilter] = useState<Status | "alla">("alla")

  useEffect(() => store.subscribe(s => { setSnap(s); setError(null) }, setError), [])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t) }, [])

  const orders = useMemo(() => snap ? [...snap.orders].sort((a, b) =>
    ORDER[a.status] - ORDER[b.status] || a.due.localeCompare(b.due) || a.id.localeCompare(b.id)) : [], [snap])

  if (!snap) return error ? (
    <div className="mx-auto mt-16 max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
      <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-bad-soft text-destructive"><AlertTriangle className="h-5 w-5" /></span>
      <h1 className="mt-3 font-bold">Kunde inte hämta data</h1>
      <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      <Button className="mt-4" onClick={() => location.reload()}>Försök igen</Button>
    </div>
  ) : (
    <div className="mx-auto max-w-7xl px-4 py-6" aria-busy="true" aria-label="Hämtar orderkön">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-7">{Array.from({ length: 7 }, (_, k) => <div key={k} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]"><div className="h-96 animate-pulse rounded-xl bg-muted" /><div className="h-96 animate-pulse rounded-xl bg-muted" /></div>
    </div>
  )
  const products = snap.products

  const count = (s: Status) => orders.filter(o => o.status === s).length
  const done = orders.filter(o => o.status === "pack" || o.status === "avv" || o.status === "skickad")
  const avgMin = avg(done.map(pickTime).filter((x): x is number => x != null))
  const late = orders.filter(o => isLate(o, now))
  const active = orders.filter(o => o.status === "plock")
  const deviations = orders.flatMap(o => o.lines.filter(l => l.dev).map(l => ({ o, l, p: products[l.sku] })))
  const stock = stockRows(products, orders)
  const refill = refillRows(stock)
  const shown = filter === "alla" ? orders : orders.filter(o => o.status === filter)

  const pickers = [...new Set([...USERS.filter(u => u.role === "plock").map(u => u.name), ...orders.map(o => o.picker).filter((x): x is string => !!x)])].map(name => {
    const mine = done.filter(o => o.picker === name)
    return {
      name,
      now: active.filter(o => o.picker === name).map(o => o.id),
      orders: mine.length,
      kolli: mine.reduce((n, o) => n + kolli(o), 0),
      avg: avg(mine.map(pickTime).filter((x): x is number => x != null)),
      devs: mine.reduce((n, o) => n + o.lines.filter(l => l.dev).length, 0),
    }
  })

  return (
    <div className="min-h-full bg-background">
      <header className="sticky top-0 z-30 border-b bg-header/90 backdrop-blur supports-[backdrop-filter]:bg-header/75">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Logo />
          <span className="hidden h-6 w-px bg-border sm:block" />
          <h1 className="text-[15px] font-bold">Plock, översikt</h1>
          <span className={cn("hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold md:flex",
            store.mode === "supabase" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")}>
            <span className={cn("h-1.5 w-1.5 rounded-full", store.mode === "supabase" ? "animate-pulse bg-ok" : "bg-warn")} />
            {store.mode === "supabase" ? "Live, uppdateras av sig själv" : "Lokal demo, bara den här webbläsaren"}
          </span>
          <div className="flex-1" />
          <a href="/" className="hidden items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground sm:flex"><ArrowLeft className="h-4 w-4" />Till plockappen</a>
          <span className="flex items-center gap-2 text-sm font-semibold"><Avatar name={user.name} size="sm" /><span className="hidden sm:inline">{user.name}</span></span>
          <Button variant="ghost" size="sm" onClick={onLogout} className="text-muted-foreground"><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Logga ut</span></Button>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 pb-2 text-sm font-medium" aria-label="Avsnitt">
          {[["order", "Order"], ["plockare", "Plockare"], ["statistik", "Statistik"], ["avvikelser", "Avvikelser"], ["saldo", "Saldo"], ["import", "Import"]].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-full px-3 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">{label}</a>
          ))}
        </nav>
      </header>
      {error && <div className="bg-bad-soft px-4 py-2 text-center text-sm text-destructive">{error}</div>}

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          <Kpi icon={<Clock className="h-4 w-4" />} label="Väntar" value={count("ny")} sub={`${orders.filter(o => o.status === "ny").reduce((n, o) => n + kolli(o), 0)} kolli`} />
          <Kpi icon={<Users className="h-4 w-4" />} label="Plockas nu" value={count("plock")} tone="warn" />
          <Kpi icon={<PackageCheck className="h-4 w-4" />} label="Klar för pack" value={count("pack")} tone="ok" sub={`${count("skickad")} skickade`} />
          <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Avvikelser" value={count("avv")} tone={count("avv") ? "bad" : undefined} sub={`${deviations.length} ${deviations.length === 1 ? "rad" : "rader"}`} />
          <Kpi icon={<Timer className="h-4 w-4" />} label="Snitt plocktid" value={avgMin != null ? `${mins(avgMin)} min` : "–"} sub={`${done.length} klara order`} />
          <Kpi icon={<TrendingDown className="h-4 w-4" />} label="Att fylla på" value={refill.length} tone={refill.length ? "warn" : "ok"} sub={refill.length ? `${refill.reduce((n, r) => n + r.need, 0)} st totalt` : "alla hyllor räcker"} />
          <Kpi icon={<Truck className="h-4 w-4" />} label="Sena" value={late.length} tone={late.length ? "bad" : "ok"} sub="passerat klart-senast" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <Section id="order" title="Alla order" right={
            <div className="flex flex-wrap gap-1">
              {(["alla", "plock", "ny", "avv", "pack", "skickad"] as const).map(s => (
                <button key={s} onClick={() => setFilter(s)}
                  className={cn("rounded-full px-2.5 py-1 text-xs font-semibold transition-colors", filter === s ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground")}>
                  {s === "alla" ? "Alla" : STATUS[s].label}
                </button>
              ))}
            </div>}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-4 py-2">Order</th><th className="px-2 py-2">Kund</th><th className="px-2 py-2">Klart senast</th>
                    <th className="px-2 py-2">Status</th><th className="px-2 py-2">Plockare</th><th className="px-2 py-2">Plockat</th><th className="px-4 py-2 text-right">Tid</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(o => {
                    const t = o.startedAt ? (o.doneAt ?? now) - o.startedAt : null
                    return (
                      <tr key={o.id} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                        <td className="px-4 py-2.5 font-bold tabular-nums">{o.id}</td>
                        <td className="px-2 py-2.5">{o.cust}</td>
                        <td className="whitespace-nowrap px-2 py-2.5 tabular-nums">
                          {o.ship === "exp" && <Zap className="mr-1 inline h-3.5 w-3.5 text-warn" />}
                          <span className={cn(isLate(o, now) && "font-bold text-destructive")}>{o.due}</span>
                          <span className="ml-1 text-muted-foreground">{o.shipTxt}</span>
                        </td>
                        <td className="px-2 py-2.5"><Badge className={cn("rounded shadow-none", STATUS[o.status].cls)}>{STATUS[o.status].label}</Badge></td>
                        <td className="px-2 py-2.5">{o.picker ?? <span className="text-muted-foreground">–</span>}</td>
                        <td className="px-2 py-2.5 tabular-nums">{picked(o)}/{kolli(o)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {t != null ? `${mins(t)} min${o.doneAt ? "" : " pågår"}` : "–"}
                        </td>
                      </tr>
                    )
                  })}
                  {!shown.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Inga order här.</td></tr>}
                </tbody>
              </table>
            </div>
          </Section>

          <div className="space-y-6">
            <Section id="plockare" title="Plockas just nu">
              <div className="divide-y">
                {active.map(o => {
                  const next = sortByLoc(o.lines, products).find(l => !lineDone(l))
                  return (
                    <div key={o.id} className="px-4 py-3">
                      <div className="flex items-baseline gap-2">
                        <span className="font-bold">{o.picker}</span>
                        <span className="text-sm text-muted-foreground">order {o.id}, {o.cust}</span>
                      </div>
                      <Progress value={(picked(o) / Math.max(1, kolli(o))) * 100} className="mt-2 h-2" />
                      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                        <span>{picked(o)} av {kolli(o)} kolli{next && products[next.sku] ? `, nästa ${products[next.sku].loc}` : ""}</span>
                        <span>{o.startedAt ? `${mins(now - o.startedAt)} min` : ""}</span>
                      </div>
                    </div>
                  )
                })}
                {!active.length && <p className="px-4 py-4 text-sm text-muted-foreground">Ingen plockar just nu.</p>}
              </div>
            </Section>

            <Section title="Plockare">
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b"><th className="px-4 py-2">Namn</th><th className="px-2 py-2">Klara</th><th className="px-2 py-2">Kolli</th><th className="px-2 py-2">Snitt</th><th className="px-4 py-2">Avv.</th></tr>
                </thead>
                <tbody>
                  {pickers.map(p => (
                    <tr key={p.name} className="border-b last:border-0">
                      <td className="px-4 py-2 font-semibold">{p.name}{p.now.length > 0 && <span className="block text-xs font-normal text-warn">plockar {p.now.join(", ")}</span>}</td>
                      <td className="px-2 py-2 tabular-nums">{p.orders}</td>
                      <td className="px-2 py-2 tabular-nums">{p.kolli}</td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">{p.avg != null ? `${mins(p.avg)} min` : "–"}</td>
                      <td className={cn("px-4 py-2 tabular-nums", p.devs > 0 && "font-bold text-destructive")}>{p.devs}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </Section>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section id="statistik" title="Plock per timme i dag"><HourChart moves={snap.moves} now={now} /></Section>
          <Section title="Felrate per vecka"><WeekChart orders={orders} now={now} /></Section>
        </div>

        <Section id="avvikelser" title="Avvikelser att åtgärda" right={<span className="text-sm text-muted-foreground">{deviations.length} st</span>}>
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {deviations.map(({ o, l, p }) => (
              <div key={l.id} className="flex gap-3 rounded-lg border p-3">
                {l.dev!.photo
                  ? <a href={l.dev!.photo} target="_blank" rel="noreferrer" className="shrink-0"><img src={l.dev!.photo} alt="Foto på avvikelsen" className="h-20 w-20 rounded object-cover" /></a>
                  : <div className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded bg-secondary text-[11px] text-muted-foreground"><Camera className="mb-1 h-5 w-5" />Inget foto</div>}
                <div className="min-w-0 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="rounded bg-bad-soft text-destructive shadow-none hover:bg-bad-soft">{l.dev!.kind}</Badge>
                    <span className="font-bold">Order {o.id}</span>
                  </div>
                  <div className="mt-1 font-semibold leading-tight">{p?.name ?? l.sku}</div>
                  <div className="text-muted-foreground">{p?.variant} · plats {p?.loc}</div>
                  <div className="mt-1">Hittade {l.dev!.found} av {l.qty}{o.picker ? `, rapporterat av ${o.picker}` : ""}{o.doneAt ? ` kl ${clock(o.doneAt)}` : ""}</div>
                  {l.dev!.note && <div className="mt-1 italic">”{l.dev!.note}”</div>}
                </div>
              </div>
            ))}
            {!deviations.length && <p className="text-sm text-muted-foreground">Inga avvikelser.</p>}
          </div>
        </Section>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <Section id="saldo" title="Saldo per hylla" right={<span className="text-sm text-muted-foreground">{refill.length} att fylla på · {stock.filter(r => r.short).length} räcker inte</span>}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b"><th className="px-4 py-2">Plats</th><th className="px-2 py-2">Artikel</th><th className="px-2 py-2 text-right">Saldo</th><th className="px-2 py-2 text-right">I kön</th><th className="px-2 py-2 text-right">Lediga</th><th className="px-2 py-2 text-right">Min</th><th className="px-2 py-2 text-right">Fyll på</th><th className="px-4 py-2 text-right">Räknad</th></tr>
                </thead>
                <tbody>
                  {stock.map(r => (
                    <tr key={r.p.sku} className="border-b last:border-0">
                      <td className="px-4 py-2 font-bold tabular-nums">{r.p.loc}</td>
                      <td className="px-2 py-2">{r.p.name}<span className="text-muted-foreground">, {r.p.variant}</span>
                        {r.short && <Badge className="ml-2 rounded bg-bad-soft text-destructive shadow-none hover:bg-bad-soft">Räcker inte</Badge>}
                        {r.low && <Badge className="ml-2 rounded bg-warn-soft text-warn shadow-none hover:bg-warn-soft">Lågt</Badge>}</td>
                      <td className="px-2 py-2 text-right font-bold tabular-nums">{r.p.stock}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.reserved}</td>
                      <td className={cn("px-2 py-2 text-right tabular-nums", r.short && "font-bold text-destructive")}>{r.free}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{r.p.minStock}</td>
                      <td className={cn("px-2 py-2 text-right tabular-nums", r.need > 0 && "font-bold text-warn")}>{r.need || "–"}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-muted-foreground">{r.p.countedAt ? new Date(r.p.countedAt).toLocaleDateString("sv-SE") : "aldrig"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title="Senaste lagerrörelser">
            <div className="divide-y">
              {snap.moves.slice(0, 12).map(m => {
                const p = products[m.sku]
                return (
                  <div key={m.id} className="flex items-baseline gap-3 px-4 py-2 text-sm">
                    <span className={cn("w-12 shrink-0 text-right font-bold tabular-nums", m.qty > 0 ? "text-ok" : "text-destructive")}>{m.qty > 0 ? `+${m.qty}` : m.qty}</span>
                    <span className="min-w-0 flex-1 truncate">{p?.loc} {p?.name}, {p?.variant}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{MOVE[m.kind]}{m.note ? ` (${m.note})` : ""} · {m.who} {clock(m.at)}</span>
                  </div>
                )
              })}
              {!snap.moves.length && <p className="px-4 py-4 text-sm text-muted-foreground">Inga rörelser sedan återställning.</p>}
            </div>
          </Section>
        </div>

        <Section id="import" title="Importera order från CSV">
          <ImportPanel products={products} existing={new Set(orders.map(o => o.id))} onImport={list => store.importOrders(list)} />
        </Section>

        <p className="text-sm text-muted-foreground">
          Påhittade order. Inloggningen är simulerad i demon. Inför skarp drift ersätts den med riktig inloggning.
        </p>
      </main>
    </div>
  )
}
