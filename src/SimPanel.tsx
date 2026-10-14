// Panelen i översikten som startar simuleringen och visar flödet live.
import { useEffect, useState } from "react"
import { AlertTriangle, ArrowRight, Inbox, PackageCheck, PackagePlus, Pause, Play, ScanLine, Send, UserCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { kolli, lineDone, type Snapshot, type Status } from "./data"
import { Avatar } from "./Login"
import { SIM_PACKER, SIM_PICKERS, type SimKind, type Simulation, type Speed } from "./sim"

const ICON: Record<SimKind, { icon: typeof Inbox; cls: string }> = {
  order: { icon: Inbox, cls: "bg-accent/60 text-accent-foreground" },
  claim: { icon: UserCheck, cls: "bg-secondary text-secondary-foreground" },
  pick: { icon: ScanLine, cls: "bg-warn-soft text-warn" },
  dev: { icon: AlertTriangle, cls: "bg-bad-soft text-destructive" },
  done: { icon: PackageCheck, cls: "bg-ok-soft text-ok" },
  pack: { icon: Send, cls: "bg-ok-soft text-ok" },
  in: { icon: PackagePlus, cls: "bg-accent/60 text-accent-foreground" },
}
const STAGES: { s: Status[]; label: string; cls: string }[] = [
  { s: ["ny"], label: "Nya", cls: "bg-secondary" },
  { s: ["plock"], label: "Plockas", cls: "bg-warn-soft" },
  { s: ["pack", "avv"], label: "Vid packbordet", cls: "bg-ok-soft" },
  { s: ["skickad"], label: "Skickade", cls: "bg-primary text-primary-foreground" },
]
const SPEEDS: { v: Speed; label: string }[] = [{ v: 1, label: "Lugnt" }, { v: 3, label: "Normalt" }, { v: 8, label: "Rusning" }]
const clock = (ms: number) => new Date(ms).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

export default function SimPanel({ sim, snap, shared }: { sim: Simulation; snap: Snapshot; shared: boolean }) {
  const [, force] = useState(0)
  useEffect(() => sim.subscribe(() => force(n => n + 1)), [sim])
  const count = (s: Status[]) => snap.orders.filter(o => s.includes(o.status)).length

  // Vad varje simulerad person gör just nu, läst från orderkön.
  const people = [...SIM_PICKERS.map(name => {
    const mine = snap.orders.filter(o => o.status === "plock" && o.picker === name)
    const left = mine.flatMap(o => o.lines).filter(l => !lineDone(l)).length
    const done = mine.reduce((n, o) => n + o.lines.reduce((m, l) => m + l.picked, 0), 0)
    return { name, role: "Plockare", text: mine.length ? `Plockar ${mine.map(o => o.id).join(", ")} · ${done}/${mine.reduce((n, o) => n + kolli(o), 0)} kolli${left ? "" : ", klar"}` : "Väntar på order" }
  }), { name: SIM_PACKER, role: "Pack och inleverans", text: count(["pack", "avv"]) ? `${count(["pack", "avv"])} order att packa` : "Fyller på hyllor" }]

  return (
    <section id="simulering" className="scroll-mt-28 overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <h2 className="font-bold tracking-tight">Simulering av flödet</h2>
        <span className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
          sim.running ? "bg-ok-soft text-ok" : "bg-secondary text-muted-foreground")}>
          <span className={cn("h-1.5 w-1.5 rounded-full", sim.running ? "animate-pulse bg-ok" : "bg-muted-foreground")} />
          {sim.running ? "Pågår" : "Pausad"}
        </span>
        <div className="flex-1" />
        <div className="flex rounded-full border bg-muted/40 p-0.5" role="group" aria-label="Fart">
          {SPEEDS.map(s => (
            <button key={s.v} onClick={() => sim.setSpeed(s.v)} aria-pressed={sim.speed === s.v}
              className={cn("rounded-full px-3 py-1 text-xs font-semibold transition-colors", sim.speed === s.v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>{s.label}</button>
          ))}
        </div>
        <Button onClick={() => (sim.running ? sim.stop() : sim.start())} className="min-w-[10rem]">
          {sim.running ? <><Pause className="h-4 w-4" />Pausa simulering</> : <><Play className="h-4 w-4" />Starta simulering</>}
        </Button>
      </div>

      <div className="grid gap-px bg-border lg:grid-cols-[1fr_420px]">
        <div className="bg-card p-4">
          <div className="flex items-stretch gap-1.5" aria-label="Orderflödet">
            {STAGES.map((st, i) => (
              <div key={st.label} className="flex flex-1 items-center gap-1.5">
                <div className={cn("flex-1 rounded-lg px-3 py-3 text-center", st.cls)}>
                  <div className="text-3xl font-extrabold tabular-nums tracking-tight">{count(st.s)}</div>
                  <div className="text-xs font-semibold opacity-80">{st.label}</div>
                </div>
                {i < STAGES.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" />}
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {people.map(p => (
              <div key={p.name} className="flex items-center gap-2.5 rounded-lg border px-3 py-2">
                <Avatar name={p.name} size="sm" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-tight">{p.name} <span className="font-normal text-muted-foreground">· {p.role}</span></div>
                  <div className="truncate text-xs text-muted-foreground">{p.text}</div>
                </div>
              </div>
            ))}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
            {([["Nya order", sim.stats.orders], ["Plockade kolli", sim.stats.picks], ["Skickade", sim.stats.packed], ["Avvikelser", sim.stats.devs], ["Inlevererat", sim.stats.received]] as const).map(([k, v]) => (
              <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-bold tabular-nums">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            {SIM_PICKERS.join(" och ")} plockar och {SIM_PACKER} packar, med samma funktioner som appen. Siffrorna ovan och statistiken längre ner uppdateras medan det pågår.
            {shared ? " Alla som har demon öppen ser samma sak." : ""} Logga in som Sara i plockappen för att plocka bredvid dem. Återställ demon i appen för att börja om.
          </p>
        </div>

        <div className="bg-card">
          <div className="border-b px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Händelser</div>
          <ol className="max-h-[300px] divide-y overflow-auto" aria-live="polite" aria-label="Händelser">
            {sim.events.map(e => {
              const I = ICON[e.kind]
              return (
                <li key={e.id} className="rise flex items-start gap-2.5 px-4 py-2 text-sm">
                  <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md", I.cls)}><I.icon className="h-3.5 w-3.5" /></span>
                  <span className="min-w-0 flex-1 leading-snug">{e.text}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{clock(e.at)}</span>
                </li>
              )
            })}
            {!sim.events.length && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Tryck på Starta simulering så börjar order komma in.</li>}
          </ol>
        </div>
      </div>
    </section>
  )
}
