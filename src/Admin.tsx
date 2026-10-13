// Översikt för arbetsledaren på datorn: hela kön live, vem som plockar vad, tider och avvikelser med foto.
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { AlertTriangle, Camera, Clock, PackageCheck, Timer, Truck, Users, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { kolli, lineDone, mins, sortByLoc, type Order, type Snapshot, type Status } from "./data"
import { createStore } from "./store"
import { USERS, currentUser, logout, type User } from "./auth"
import Login, { Logo } from "./Login"
import ImportPanel from "./ImportPanel"
import { stockRows } from "./Lager"
import { Button } from "@/components/ui/button"

const store = createStore()

const STATUS: Record<Status, { label: string; cls: string }> = {
  ny: { label: "Ny", cls: "bg-secondary text-secondary-foreground" },
  plock: { label: "Plockas", cls: "bg-warn-soft text-warn" },
  pack: { label: "Klar för pack", cls: "bg-ok-soft text-ok" },
  avv: { label: "Avvikelse", cls: "bg-bad-soft text-destructive" },
  skickad: { label: "Skickad", cls: "bg-secondary text-secondary-foreground" },
}
const MOVE = { in: "Inleverans", plock: "Plock", avvikelse: "Avvikelse" }
const ORDER: Record<Status, number> = { plock: 0, ny: 1, avv: 2, pack: 3, skickad: 4 }

const dueAt = (o: Order) => { const [h, m] = o.due.split(":").map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime() }
const isLate = (o: Order, now: number) => (o.status === "ny" || o.status === "plock") && now > dueAt(o)
const picked = (o: Order) => o.lines.reduce((n, l) => n + l.picked, 0)
const pickTime = (o: Order) => (o.startedAt && o.doneAt ? o.doneAt - o.startedAt : null)
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const clock = (ms: number) => new Date(ms).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })

function Kpi({ icon, label, value, sub, tone }: { icon: ReactNode; label: string; value: ReactNode; sub?: string; tone?: "ok" | "bad" | "warn" }) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{icon}{label}</div>
      <div className={cn("mt-1 text-3xl font-extrabold tabular-nums",
        tone === "ok" && "text-ok", tone === "bad" && "text-destructive", tone === "warn" && "text-warn")}>{value}</div>
      {sub && <div className="text-sm text-muted-foreground">{sub}</div>}
    </div>
  )
}

const Section = ({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) => (
  <section className="min-w-0 rounded-md border bg-card">
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3"><h2 className="flex-1 font-bold">{title}</h2>{right}</div>
    {children}
  </section>
)

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

  if (!snap) return <div className="p-8 text-muted-foreground">{error ? `Kunde inte hämta data: ${error}` : "Hämtar orderkön…"}</div>
  const products = snap.products

  const count = (s: Status) => orders.filter(o => o.status === s).length
  const done = orders.filter(o => o.status === "pack" || o.status === "avv" || o.status === "skickad")
  const avgMin = avg(done.map(pickTime).filter((x): x is number => x != null))
  const late = orders.filter(o => isLate(o, now))
  const active = orders.filter(o => o.status === "plock")
  const deviations = orders.flatMap(o => o.lines.filter(l => l.dev).map(l => ({ o, l, p: products[l.sku] })))
  const stock = stockRows(products, orders)
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
      <header className="border-b bg-header">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Logo />
          <h1 className="text-lg font-bold">Plock, översikt</h1>
          <div className="flex-1" />
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className={cn("h-2 w-2 rounded-full", store.mode === "supabase" ? "bg-ok" : "bg-warn")} />
            {store.mode === "supabase" ? "Live, uppdateras av sig själv" : "Lokal demo, bara den här webbläsaren"}
          </span>
          <a href="/" className="text-sm text-muted-foreground underline">Till plockappen</a>
          <span className="text-sm">{user.name} <button className="ml-1 text-muted-foreground underline" onClick={onLogout}>Logga ut</button></span>
        </div>
      </header>
      {error && <div className="bg-bad-soft px-4 py-2 text-center text-sm text-destructive">{error}</div>}

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Kpi icon={<Clock className="h-4 w-4" />} label="Väntar" value={count("ny")} sub={`${orders.filter(o => o.status === "ny").reduce((n, o) => n + kolli(o), 0)} kolli`} />
          <Kpi icon={<Users className="h-4 w-4" />} label="Plockas nu" value={count("plock")} tone="warn" />
          <Kpi icon={<PackageCheck className="h-4 w-4" />} label="Klar för pack" value={count("pack")} tone="ok" sub={`${count("skickad")} skickade`} />
          <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Avvikelser" value={count("avv")} tone={count("avv") ? "bad" : undefined} sub={`${deviations.length} ${deviations.length === 1 ? "rad" : "rader"}`} />
          <Kpi icon={<Timer className="h-4 w-4" />} label="Snitt plocktid" value={avgMin != null ? `${mins(avgMin)} min` : "–"} sub={`${done.length} klara order`} />
          <Kpi icon={<Truck className="h-4 w-4" />} label="Sena" value={late.length} tone={late.length ? "bad" : "ok"} sub="passerat klart-senast" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <Section title="Alla order" right={
            <div className="flex flex-wrap gap-1">
              {(["alla", "plock", "ny", "avv", "pack", "skickad"] as const).map(s => (
                <button key={s} onClick={() => setFilter(s)}
                  className={cn("rounded px-2 py-1 text-xs font-semibold", filter === s ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground")}>
                  {s === "alla" ? "Alla" : STATUS[s].label}
                </button>
              ))}
            </div>}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-4 py-2">Order</th><th className="px-2 py-2">Kund</th><th className="px-2 py-2">Klart senast</th>
                    <th className="px-2 py-2">Status</th><th className="px-2 py-2">Plockare</th><th className="px-2 py-2">Plockat</th><th className="px-4 py-2 text-right">Tid</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(o => {
                    const t = o.startedAt ? (o.doneAt ?? now) - o.startedAt : null
                    return (
                      <tr key={o.id} className="border-b last:border-0">
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
            <Section title="Plockas just nu">
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
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
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

        <Section title="Avvikelser att åtgärda" right={<span className="text-sm text-muted-foreground">{deviations.length} st</span>}>
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {deviations.map(({ o, l, p }) => (
              <div key={l.id} className="flex gap-3 rounded-md border p-3">
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
          <Section title="Saldo per hylla" right={<span className="text-sm text-muted-foreground">{stock.filter(r => r.short).length} räcker inte · {stock.filter(r => r.low).length} låga</span>}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b"><th className="px-4 py-2">Plats</th><th className="px-2 py-2">Artikel</th><th className="px-2 py-2 text-right">Saldo</th><th className="px-2 py-2 text-right">I kön</th><th className="px-2 py-2 text-right">Lediga</th><th className="px-4 py-2 text-right">Min</th></tr>
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
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{r.p.minStock}</td>
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

        <Section title="Importera order från CSV">
          <ImportPanel products={products} existing={new Set(orders.map(o => o.id))} onImport={list => store.importOrders(list)} />
        </Section>

        <p className="text-sm text-muted-foreground">
          Påhittade order. Inloggningen är simulerad i demon. Inför skarp drift ersätts den med riktig inloggning.
        </p>
      </main>
    </div>
  )
}
