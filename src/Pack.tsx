// Packstation: skanna ordern från plocklådan, kontrollera varorna, väg och skriv ut packsedel.
import { useEffect, useRef, useState } from "react"
import { Check, ChevronLeft, PackageCheck, Printer, Scale } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { expectedWeight, kolli, sortByLoc, type Order, type Products } from "./data"
import { Logo } from "./Login"
import { Chip, Pict, ScanBar, DemoLabel } from "./parts"
import { lang, t } from "./i18n"

type Say = (kind: "ok" | "err" | "warn", title: string, sub?: string, sticky?: boolean) => void
const loc = () => (lang === "sv" ? "sv-SE" : lang)
const kg = (n: number) => `${n.toLocaleString(loc(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`
const clock = (ms: number) => new Date(ms).toLocaleTimeString(loc(), { hour: "2-digit", minute: "2-digit" })
const packable = (o: Order) => o.status === "pack" || o.status === "avv"
const delivered = (o: Order) => o.lines.reduce((n, l) => n + l.picked, 0)

export function Pack({ orders, products, me, say, onNoCamera, onPack, onPrint }: {
  orders: Order[]; products: Products; me: string; say: Say; onNoCamera: () => void
  onPack: (id: string, weight: number) => Promise<boolean>; onPrint: (o: Order) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [doneId, setDoneId] = useState<string | null>(null)
  const ready = orders.filter(packable).sort((a, b) => (a.ship === b.ship ? 0 : a.ship === "exp" ? -1 : 1) || a.due.localeCompare(b.due))
  const sent = orders.filter(o => o.status === "skickad").sort((a, b) => (b.packedAt ?? 0) - (a.packedAt ?? 0))
  const open = orders.find(o => o.id === openId && packable(o))
  const done = orders.find(o => o.id === doneId && o.status === "skickad")

  function onScan(raw: string) {
    const code = raw.trim().replace(/^#/, "").toUpperCase()
    if (!code) return
    const o = orders.find(x => x.id === code)
    if (!o) { say("warn", t("p.unknown"), code); return }
    if (o.status === "skickad") { say("warn", t("p.already", { id: o.id }), o.packer ? t("p.alreadySub", { who: o.packer, t: clock(o.packedAt ?? 0) }) : undefined); return }
    if (!packable(o)) { say("warn", t("p.notPicked", { id: o.id }), o.status === "plock" ? t("p.picking", { who: o.picker ?? "" }) : t("p.inQueue")); return }
    setDoneId(null); setOpenId(o.id); say("ok", t("p.opened", { id: o.id }), t("p.openedSub", { cust: o.cust }))
  }

  if (open) return <PackOrder key={open.id} o={open} products={products} say={say} onNoCamera={onNoCamera} onBack={() => setOpenId(null)}
    onPack={async w => {
      if (!await onPack(open.id, w)) { say("warn", t("p.failed"), t("p.failedSub")); return }
      say("ok", t("p.packedFlash", { id: open.id, w: kg(w) }), t("p.printing"))
      setOpenId(null); setDoneId(open.id); onPrint({ ...open, status: "skickad", packer: me, packedAt: Date.now(), weight: w })
    }} />

  return (
    <main className="mx-auto max-w-xl px-4 pb-36">
      <h1 className="mt-5 text-2xl font-bold tracking-tight">{t("p.title")}</h1>
      <p className="text-muted-foreground">{ready.length ? t("p.waiting", { n: ready.length }) : t("p.noneWaiting")}</p>

      {done && (
        <div className="mt-4 flex items-center gap-3 rounded-md bg-ok-soft p-3 text-sm">
          <PackageCheck className="h-8 w-8 shrink-0 text-ok" />
          <div className="min-w-0 flex-1"><b>{t("p.packedOk", { id: done.id })}</b><br />{done.cust} · {done.weight != null && kg(done.weight)}</div>
          <Button variant="outline" className="h-10 bg-card" onClick={() => onPrint(done)}><Printer className="!h-4 !w-4" />{t("p.again")}</Button>
        </div>
      )}

      <ScanBar placeholder={t("p.scan")} hint={t("p.hint")} onScan={onScan} onNoCamera={onNoCamera} focusKey={doneId} />
      {ready.length > 0 && (
        <div className="demo-box mt-3 flex flex-wrap items-center gap-2">
          <DemoLabel />
          <Chip onClick={() => onScan(ready[0].id)}>{t("p.order")} <code className="font-mono text-xs text-muted-foreground">{ready[0].id}</code></Chip>
          {sent[0] && <Chip bad onClick={() => onScan(sent[0].id)}>{t("p.alreadyChecked")} <code className="font-mono text-xs">{sent[0].id}</code></Chip>}
        </div>
      )}

      <h2 className="mb-2 mt-7 text-[13px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{t("p.queue")}</h2>
      {ready.length ? (
        <div className="grid gap-2.5">
          {ready.map(o => (
            <button key={o.id} onClick={() => onScan(o.id)} className="rounded-md border bg-card p-3.5 text-left">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[13px] text-muted-foreground">#{o.id}</span>
                {o.ship === "exp" && <span className="rounded bg-strip px-1.5 text-xs font-bold text-strip-foreground">{t("p.express")}</span>}
                {o.status === "avv" && <span className="rounded bg-bad-soft px-1.5 text-xs font-bold text-destructive">{t("status.avv")}</span>}
                <span className="ml-auto text-sm text-muted-foreground">{t("pick.out", { t: o.due })}</span>
              </div>
              <div className="mt-1 font-semibold">{o.cust}</div>
              <div className="text-sm text-muted-foreground">{t("p.kolliOf", { a: delivered(o), b: kolli(o) })} · {t("p.pickedBy", { who: o.picker ?? "" })}</div>
            </button>
          ))}
        </div>
      ) : <p className="text-sm text-muted-foreground">{t("p.allPacked")}</p>}

      {sent.length > 0 && (
        <>
          <h2 className="mb-2 mt-7 text-[13px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{t("p.sent")}</h2>
          <div className="overflow-hidden rounded-md border bg-card">
            {sent.map(o => (
              <div key={o.id} className="flex items-center gap-3 border-t px-3 py-2.5 text-sm first:border-t-0">
                <span className="min-w-0 flex-1"><b className="font-mono">#{o.id}</b> {o.cust}
                  <span className="block text-muted-foreground">{o.packer} {o.packedAt ? clock(o.packedAt) : ""} · {o.weight != null && kg(o.weight)}</span></span>
                <button className="flex items-center gap-1 text-muted-foreground underline" onClick={() => onPrint(o)}><Printer className="h-4 w-4" />{t("p.slip")}</button>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  )
}

function PackOrder({ o, products, say, onNoCamera, onBack, onPack }: {
  o: Order; products: Products; say: Say; onNoCamera: () => void; onBack: () => void; onPack: (weight: number) => Promise<void>
}) {
  const lines = sortByLoc(o.lines, products)
  const [checked, setChecked] = useState<Record<string, number>>({})
  const [weight, setWeight] = useState("")
  const [busy, setBusy] = useState(false)
  const total = delivered(o)
  const ok = lines.reduce((n, l) => n + Math.min(l.picked, checked[l.id] ?? 0), 0)
  const expected = expectedWeight(o, products)
  const w = Number(weight.replace(",", "."))
  const off = w > 0 && Math.abs(w - expected) / expected > 0.1
  const allChecked = ok >= total
  const scaleRef = useRef<HTMLInputElement>(null)

  function onScan(raw: string) {
    const code = raw.trim().toUpperCase()
    if (!code) return
    const p = Object.values(products).find(q => q.ean === code)
    if (!p) { say("warn", t("f.unknown"), code); return }
    const mine = lines.filter(l => l.sku === p.sku)
    if (!mine.length) { say("err", t("p.notInOrder"), t("p.notInOrderSub", { name: p.name, variant: p.variant }), true); return }
    const l = mine.find(x => (checked[x.id] ?? 0) < x.picked)
    if (!l) { say("warn", t("p.alreadyChecked"), t("p.alreadyCheckedSub", { n: mine.reduce((n, x) => n + x.picked, 0), variant: p.variant }), true); return }
    const n = (checked[l.id] ?? 0) + 1
    setChecked({ ...checked, [l.id]: n })
    say("ok", t("p.checkedOne", { name: p.name, a: n, b: l.picked }), ok + 1 >= total ? t("p.allChecked") : undefined)
    if (ok + 1 >= total) setTimeout(() => scaleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50)
  }

  // Simulerad våg: förväntad vikt med lite spridning, så som en riktig våg skulle visa.
  const weigh = () => setWeight(String(Math.round(expected * (0.97 + Math.random() * 0.06) * 10) / 10).replace(".", ","))
  const next = lines.find(l => (checked[l.id] ?? 0) < l.picked)

  return (
    <main className="mx-auto max-w-xl px-4 pb-36">
      <button className="mt-3 -ml-1 flex items-center gap-1 text-base font-semibold" onClick={onBack}><ChevronLeft className="h-5 w-5" />{t("p.title")}</button>
      <div className="mt-2 flex items-baseline gap-2">
        <h1 className="text-2xl font-bold tracking-tight">#{o.id}</h1>
        <span className="min-w-0 truncate text-muted-foreground">{o.cust}</span>
      </div>
      <p className="text-sm text-muted-foreground">{t("done.shipVal", { txt: o.shipTxt, due: o.due })} · {t("p.pickedBy", { who: o.picker ?? "" })}</p>

      <div className="mt-4 flex justify-between text-sm tabular-nums text-muted-foreground"><span>{t("p.checked", { a: ok, b: total })}</span>{allChecked && <span className="font-semibold text-ok">{t("p.done")}</span>}</div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-ok transition-all" style={{ width: `${(ok / Math.max(1, total)) * 100}%` }} /></div>

      {!allChecked && (
        <>
          <ScanBar placeholder={t("p.scanItems")} hint={t("hint.item")} onScan={onScan} onNoCamera={onNoCamera} focusKey={ok} />
          <div className="demo-box mt-3 flex flex-wrap items-center gap-2">
            <DemoLabel />
            {next && <Chip onClick={() => onScan(products[next.sku].ean)}>{t("p.next")}</Chip>}
            {(() => { const x = Object.values(products).find(q => !lines.some(l => l.sku === q.sku)); return x && <Chip bad onClick={() => onScan(x.ean)}>{t("chip.wrongItem")}</Chip> })()}
            <Chip onClick={() => setChecked(Object.fromEntries(lines.map(l => [l.id, l.picked])))}>{t("p.allRight")}</Chip>
          </div>
        </>
      )}

      <div className="mt-4 overflow-hidden rounded-md border bg-card">
        {lines.map(l => {
          const p = products[l.sku]; const c = Math.min(l.picked, checked[l.id] ?? 0); const rest = l.qty - l.picked
          return (
            <div key={l.id} className={cn("flex items-center gap-3 border-t px-3 py-2.5 first:border-t-0", c >= l.picked && "bg-ok-soft/50")}>
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded bg-muted text-muted-foreground">{p && <Pict type={p.type} className="h-8 w-8" />}</div>
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate font-semibold">{p?.name}</div>
                <div className="truncate text-muted-foreground">{p?.variant}</div>
                {rest > 0 && <div className="text-xs font-semibold text-destructive">{t("p.rest", { n: rest, kind: l.dev ? t(`dev.${l.dev.kind}`) : t("p.missing") })}</div>}
              </div>
              <div className="text-right text-lg font-extrabold tabular-nums">
                {l.picked === 0 ? <span className="text-muted-foreground">–</span>
                  : c >= l.picked ? <span className="flex items-center gap-1 text-ok"><Check className="h-4 w-4" strokeWidth={3} />{l.picked}</span> : `${c}/${l.picked}`}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-5 rounded-md border bg-card p-4">
        <div className="flex items-center gap-2 font-bold"><Scale className="h-5 w-5" />{t("p.weight")}</div>
        <div className="mt-3 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <input ref={scaleRef} value={weight} onChange={e => setWeight(e.target.value)} inputMode="decimal" placeholder="0,0" aria-label={t("p.weightAria")}
              className="h-12 w-full rounded-md border bg-background px-3 pr-10 text-2xl font-extrabold tabular-nums outline-none focus:border-ring" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">kg</span>
          </div>
          <Button variant="outline" className="h-12" onClick={weigh}>{t("p.scale")}</Button>
        </div>
        <p className={cn("mt-2 text-sm", off ? "font-semibold text-warn" : "text-muted-foreground")}>
          {off ? t("p.off", { w: kg(expected) }) : t("p.expect", { w: kg(expected) })}
        </p>
      </div>

      <Button className="mt-5 h-12 w-full bg-ok text-base font-bold text-white hover:bg-ok/90" disabled={!allChecked || !(w > 0) || busy}
        onClick={async () => { setBusy(true); try { await onPack(w) } finally { setBusy(false) } }}>
        <Printer className="!h-5 !w-5" />{t("p.packBtn")}
      </Button>
      {!allChecked && <p className="mt-2 text-center text-sm text-muted-foreground">{t("p.scanFirst")}</p>}
    </main>
  )
}

// Packsedeln visas bara vid utskrift.
export function PackingSlip({ o, products }: { o: Order; products: Products }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    void import("jsbarcode").then(({ default: JsBarcode }) => {
      if (ref.current) JsBarcode(ref.current, o.id, { format: "CODE128", height: 50, width: 2, fontSize: 14, margin: 0 })
    })
  }, [o.id])
  const rest = o.lines.filter(l => l.picked < l.qty)
  return (
    <div className="hidden bg-white p-8 text-[13px] text-black print:block" data-testid="packsedel">
      <div className="flex items-start justify-between">
        <div><Logo /><div className="mt-2 text-2xl font-extrabold">{t("slip.title")}</div></div>
        <div className="text-right"><svg ref={ref} /><div className="mt-1">{t("p.order")} {o.id}</div></div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-6">
        <div><div className="text-[11px] font-bold uppercase text-neutral-500">{t("slip.cust")}</div><div className="font-semibold">{o.cust}</div></div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3">
          <span className="text-neutral-500">{t("slip.date")}</span><span>{new Date(o.packedAt ?? Date.now()).toLocaleDateString(loc())}</span>
          <span className="text-neutral-500">{t("slip.ship")}</span><span>{o.shipTxt}</span>
          <span className="text-neutral-500">{t("slip.weight")}</span><span>{o.weight != null ? kg(o.weight) : "–"}</span>
          <span className="text-neutral-500">{t("slip.by")}</span><span>{o.packer ?? "–"}</span>
        </div>
      </div>
      <table className="mt-6 w-full border-collapse">
        <thead><tr className="border-b-2 border-black text-left"><th className="py-1.5">{t("slip.sku")}</th><th>{t("slip.name")}</th><th className="text-right">{t("slip.ordered")}</th><th className="text-right">{t("slip.delivered")}</th><th className="text-right">{t("slip.rest")}</th></tr></thead>
        <tbody>
          {sortByLoc(o.lines, products).map(l => { const p = products[l.sku]; return (
            <tr key={l.id} className="border-b border-neutral-300">
              <td className="py-1.5 font-mono">{l.sku}</td><td>{p?.name}, {p?.variant}</td>
              <td className="text-right">{l.qty}</td><td className="text-right font-bold">{l.picked}</td><td className="text-right">{l.qty - l.picked || ""}</td>
            </tr>) })}
        </tbody>
      </table>
      {rest.length > 0 && <p className="mt-4">{t("slip.restNote")}</p>}
      <p className="mt-10 text-[11px] text-neutral-500">{t("slip.demo")}</p>
    </div>
  )
}
