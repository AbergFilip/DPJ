// Inleverans (skanna in varor på hyllan) och saldo per hyllplats.
import { useEffect, useState } from "react"
import { ClipboardCheck, Minus, PackagePlus, Plus, Search, TrendingDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { reserved, type Order, type Product, type Products, type StockMove } from "./data"
import { Chip, Pict, ScanBar } from "./parts"

type Say = (kind: "ok" | "err" | "warn", title: string, sub?: string, sticky?: boolean) => void
const byLoc = (a: Product, b: Product) => a.loc.localeCompare(b.loc, "sv", { numeric: true })
const time = (ms: number) => new Date(ms).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })

export function Inleverans({ products, moves, say, onReceive, onNoCamera, preset }: {
  products: Products; moves: StockMove[]; say: Say; onNoCamera: () => void
  onReceive: (sku: string, qty: number) => Promise<number | null>
  preset?: string | null
}) {
  const [sku, setSku] = useState<string | null>(preset ?? null)
  const [qty, setQty] = useState(1)
  useEffect(() => { if (preset) { setSku(preset); setQty(1) } }, [preset])
  const [busy, setBusy] = useState(false)
  const all = Object.values(products).sort(byLoc)
  const p = sku ? products[sku] : undefined

  async function onScan(raw: string) {
    const code = raw.trim().toUpperCase()
    if (!code || busy) return
    const ean = all.find(q => q.ean === code)
    const loc = all.find(q => q.loc === code)
    if (ean) {
      if (ean.sku === sku) { setQty(n => Math.min(999, n + 1)); say("ok", `${ean.name}: ${qty + 1} st`, "Skanna nästa, eller hyllan när du är klar.") }
      else { setSku(ean.sku); setQty(1); say("ok", ean.name, `${ean.variant}. Ställs på ${ean.loc}.`) }
      return
    }
    if (!p) { say("warn", loc ? "Skanna varan först" : "Okänd kod", loc ? "Börja med varans streckkod." : code); return }
    if (code !== p.loc) { say("warn", loc ? `Fel hylla: ${code}` : "Okänd kod", `${p.name} ska till ${p.loc}.`); return }
    setBusy(true)
    try {
      const v = await onReceive(p.sku, qty)
      if (v == null) { say("err", "Inleveransen sparades inte", "Försök igen.", true); return }
      say("ok", `${qty} st in på ${p.loc}`, `Nytt saldo: ${v} st.`)
      setSku(null); setQty(1)
    } catch { /* felet visas via onError */ } finally { setBusy(false) }
  }

  const low = all.find(q => q.stock <= q.minStock) ?? all[0]
  const other = all.find(q => q !== low)
  const wrongLoc = p && all.find(q => q.loc !== p.loc)
  const recent = moves.filter(m => m.kind === "in").slice(0, 5)

  return (
    <main className="mx-auto max-w-xl px-4 pb-24">
      <h1 className="mt-5 text-2xl font-bold tracking-tight">Inleverans</h1>
      <p className="text-muted-foreground">{p ? "Skanna fler av samma vara, eller hyllan för att ställa in dem." : "Skanna varans streckkod."}</p>

      {p ? (
        <div className="mt-4 overflow-hidden rounded-md border bg-card">
          <div className="flex bg-sign text-sign-foreground">
            <div className="flex-1 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-75">Ställ på hyllplats</div>
              <div className="text-[44px] font-extrabold leading-none tracking-tight tabular-nums">{p.loc}</div>
            </div>
            <div className="border-l border-white/20 px-4 py-3 text-right">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-75">Saldo nu</div>
              <div className="text-[40px] font-extrabold leading-none tabular-nums">{p.stock}</div>
            </div>
          </div>
          <div className="flex items-center gap-3.5 px-4 py-3.5">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded bg-muted text-muted-foreground"><Pict type={p.type} className="h-10 w-10" /></div>
            <div className="min-w-0">
              <div className="font-bold leading-tight">{p.name}</div>
              <div className="mt-1"><span className="rounded bg-accent px-1.5 py-0.5 font-bold text-accent-foreground">{p.variant}</span></div>
            </div>
          </div>
          <div className="flex items-center gap-3 border-t px-4 py-3">
            <span className="flex-1 text-sm text-muted-foreground">Antal in</span>
            <Button variant="outline" className="h-12 w-12" aria-label="Minska" onClick={() => setQty(Math.max(1, qty - 1))}><Minus /></Button>
            <output className="min-w-12 text-center text-3xl font-extrabold tabular-nums">{qty}</output>
            <Button variant="outline" className="h-12 w-12" aria-label="Öka" onClick={() => setQty(Math.min(999, qty + 1))}><Plus /></Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid place-items-center rounded-md border-2 border-dashed px-4 py-8 text-center text-muted-foreground">
          <PackagePlus className="h-10 w-10" />
          <div className="mt-2 font-semibold text-foreground">Skanna en vara som ska in på lagret</div>
          <div className="text-sm">Appen visar vilken hylla den ska stå på.</div>
        </div>
      )}

      <ScanBar placeholder={p ? "Skanna vara eller hylla" : "Skanna varans streckkod"} onScan={onScan} onNoCamera={onNoCamera}
        hint={p ? "Rikta mot hylletiketten" : "Rikta mot varans streckkod"} focusKey={`${sku}-${qty}`} />

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted-foreground">Testa:</span>
        {!p ? (
          <>
            {low && <Chip onClick={() => onScan(low.ean)}>{low.name.split(" ")[0]} <span className="text-xs text-muted-foreground">{low.variant}</span></Chip>}
            {other && <Chip onClick={() => onScan(other.ean)}>{other.name.split(" ")[0]} <span className="text-xs text-muted-foreground">{other.variant}</span></Chip>}
          </>
        ) : (
          <>
            <Chip onClick={() => onScan(p.ean)}>En till</Chip>
            <Chip onClick={() => onScan(p.loc)}>Rätt hylla <code className="font-mono text-xs text-muted-foreground">{p.loc}</code></Chip>
            {wrongLoc && <Chip bad onClick={() => onScan(wrongLoc.loc)}>Fel hylla <code className="font-mono text-xs">{wrongLoc.loc}</code></Chip>}
          </>
        )}
      </div>
      {p && <div className="mt-4 text-center"><button className="text-sm text-muted-foreground underline" onClick={() => { setSku(null); setQty(1) }}>Avbryt</button></div>}

      <h2 className="mb-2 mt-8 text-[13px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Senaste inleveranser</h2>
      {recent.length ? (
        <div className="overflow-hidden rounded-md border bg-card">
          {recent.map(m => {
            const q = products[m.sku]
            return (
              <div key={m.id} className="grid grid-cols-[64px_1fr_auto] items-center gap-2.5 border-t px-3 py-2.5 text-sm first:border-t-0">
                <span className="font-extrabold tabular-nums">{q?.loc}</span>
                <span className="min-w-0"><span className="block truncate font-semibold">{q?.name}</span><span className="block truncate text-muted-foreground">{q?.variant} · {m.who} {time(m.at)}</span></span>
                <span className="font-bold tabular-nums text-ok">+{m.qty}</span>
              </div>
            )
          })}
        </div>
      ) : <p className="text-sm text-muted-foreground">Inga inleveranser ännu.</p>}
    </main>
  )
}

export function stockRows(products: Products, orders: Order[]) {
  const res = reserved(orders)
  return Object.values(products).sort(byLoc).map(p => {
    const r = res[p.sku] ?? 0
    const free = p.stock - r
    // Påfyllnad: fyll upp till orderna i kön plus ett min-saldo kvar på hyllan.
    const need = Math.max(r + p.minStock - p.stock, 0)
    return { p, reserved: r, free, short: free < 0, low: free >= 0 && p.stock <= p.minStock, need }
  })
}
export type StockRow = ReturnType<typeof stockRows>[number]
// Raderna som behöver påfyllnad, sämst först.
export const refillRows = (rows: StockRow[]) => rows.filter(r => r.need > 0).sort((a, b) => (b.short ? 1 : 0) - (a.short ? 1 : 0) || b.need - a.need)

export function Saldo({ products, orders, onRefill, onCount }: {
  products: Products; orders: Order[]; onRefill: (sku: string) => void; onCount: (sku: string) => void
}) {
  const [q, setQ] = useState("")
  const [onlyLow, setOnlyLow] = useState(false)
  const rows = stockRows(products, orders)
  const needle = q.trim().toLowerCase()
  const shown = rows.filter(r => (!onlyLow || r.short || r.low) &&
    (!needle || [r.p.loc, r.p.name, r.p.variant, r.p.sku, r.p.ean].some(x => x.toLowerCase().includes(needle))))
  const shortN = rows.filter(r => r.short).length, lowN = rows.filter(r => r.low).length
  const refill = refillRows(rows)

  return (
    <main className="mx-auto max-w-xl px-4 pb-24">
      <h1 className="mt-5 text-2xl font-bold tracking-tight">Saldo per hylla</h1>
      <p className="text-muted-foreground">
        {shortN ? `${shortN} artiklar räcker inte till orderna i kön. ` : ""}{lowN ? `${lowN} har lågt saldo.` : !shortN ? "Allt räcker till orderna i kön." : ""}
      </p>

      <h2 className="mb-2 mt-6 flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        <TrendingDown className="h-4 w-4" />Att fylla på
      </h2>
      {refill.length ? (
        <div className="grid gap-2">
          {refill.map(r => (
            <div key={r.p.sku} className={cn("rounded-md border bg-card p-3", r.short && "border-destructive")}>
              <div className="flex items-center gap-2.5">
                <span className="text-lg font-extrabold tabular-nums">{r.p.loc}</span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-semibold">{r.p.name}</span>
                  <span className="block truncate text-muted-foreground">{r.p.variant}</span>
                </span>
                <span className="text-right text-sm leading-tight">
                  <b className="block text-2xl font-extrabold tabular-nums text-warn">{r.need}</b>
                  <span className="text-xs text-muted-foreground">att fylla på</span>
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="flex-1 text-xs text-muted-foreground">
                  {r.p.stock} på hyllan{r.reserved > 0 ? `, ${r.reserved} i kön` : ""}
                  {r.short ? <b className="ml-1.5 rounded bg-bad-soft px-1 text-destructive">Räcker inte</b> : <b className="ml-1.5 rounded bg-warn-soft px-1 text-warn">Lågt</b>}
                </span>
                <Button variant="outline" className="h-10" onClick={() => onCount(r.p.sku)}>Räkna</Button>
                <Button className="h-10" onClick={() => onRefill(r.p.sku)}>Fyll på</Button>
              </div>
            </div>
          ))}
        </div>
      ) : <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">Inget behöver fyllas på. Alla hyllor räcker till orderna i kön.</p>}

      <h2 className="mb-2 mt-7 text-[13px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Alla hyllplatser</h2>
      <div className="mt-4 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Sök plats, artikel eller EAN" aria-label="Sök"
            className="h-11 w-full rounded-md border bg-card pl-9 pr-3 text-base outline-none focus:border-ring" />
        </div>
        <Button variant={onlyLow ? "default" : "outline"} className="h-11" onClick={() => setOnlyLow(!onlyLow)}>Bara låga</Button>
      </div>
      <div className="mt-3 overflow-hidden rounded-md border bg-card">
        {shown.map(({ p, reserved: r, free, short, low }) => (
          <div key={p.sku} className="grid grid-cols-[64px_1fr_auto] items-center gap-2.5 border-t px-3 py-2.5 first:border-t-0">
            <span className="text-lg font-extrabold tabular-nums">{p.loc}</span>
            <span className="min-w-0 text-sm">
              <span className="block truncate font-semibold">{p.name}</span>
              <span className="block truncate text-muted-foreground">{p.variant}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {r > 0 ? `${r} i kön · ` : ""}{free} lediga
                {short && <b className="ml-1.5 rounded bg-bad-soft px-1 text-destructive">Räcker inte</b>}
                {low && <b className="ml-1.5 rounded bg-warn-soft px-1 text-warn">Lågt</b>}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className={cn("text-right text-2xl font-extrabold tabular-nums", short && "text-destructive")}>
                {p.stock}<span className="block text-[11px] font-medium text-muted-foreground">st</span>
              </span>
              <button aria-label={`Räkna ${p.loc}`} onClick={() => onCount(p.sku)} className="grid h-10 w-10 place-items-center rounded-md border text-muted-foreground"><ClipboardCheck className="h-4 w-4" /></button>
            </span>
          </div>
        ))}
        {!shown.length && <p className="px-3 py-4 text-sm text-muted-foreground">Inga träffar.</p>}
      </div>
    </main>
  )
}

/* ---------- Inventering ---------- */

// Räkna en hyllplats: skanna hyllan eller varan, slå in antalet och se skillnaden mot saldot.
export function Inventering({ products, orders, moves, say, preset, onNoCamera, onCount, onDone }: {
  products: Products; orders: Order[]; moves: StockMove[]; say: Say; preset?: string | null
  onNoCamera: () => void; onCount: (sku: string, counted: number, note: string) => Promise<number | null>; onDone: () => void
}) {
  const [sku, setSku] = useState<string | null>(preset ?? null)
  const [typed, setTyped] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<{ loc: string; diff: number } | null>(null)
  useEffect(() => { if (preset) { setSku(preset); setTyped("") } }, [preset])
  const all = Object.values(products).sort(byLoc)
  const p = sku ? products[sku] : undefined
  const counted = typed === "" ? null : Math.min(9999, Number(typed))
  const diff = p && counted != null ? counted - p.stock : null
  const rows = stockRows(products, orders)
  const never = all.filter(q => !q.countedAt)

  function onScan(raw: string) {
    const code = raw.trim().toUpperCase()
    if (!code) return
    const q = all.find(x => x.loc === code) ?? all.find(x => x.ean === code)
    if (!q) { say("warn", "Okänd kod", code); return }
    setSku(q.sku); setTyped(""); setNote(""); setLast(null)
    say("ok", `${q.loc}: ${q.name}`, "Räkna allt som står på hyllan och slå in antalet.")
  }

  async function save() {
    if (!p || counted == null || busy) return
    setBusy(true)
    try {
      const v = await onCount(p.sku, counted, note.trim())
      if (v == null) { say("err", "Inventeringen sparades inte", "Försök igen.", true); return }
      const d = counted - p.stock
      say(d === 0 ? "ok" : "warn", d === 0 ? `${p.loc} stämmer: ${v} st` : `${p.loc} rättat till ${v} st`,
        d === 0 ? "Inget att rätta." : `Saldot ändrades ${d > 0 ? "+" : ""}${d} st.`)
      setLast({ loc: p.loc, diff: d }); setSku(null); setTyped(""); setNote("")
    } catch { /* felet visas via onError */ } finally { setBusy(false) }
  }

  const key = (c: string) => setTyped(c === "<" ? typed.slice(0, -1) : (typed + c).replace(/^0+(?=\d)/, "").slice(0, 4))

  return (
    <main className="mx-auto max-w-xl px-4 pb-24">
      <button className="mt-3 -ml-1 flex items-center gap-1 text-base font-semibold" onClick={onDone}>Tillbaka till saldo</button>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Inventering</h1>
      <p className="text-muted-foreground">{p ? "Räkna allt som står på hyllan och slå in antalet." : "Skanna hyllan du vill räkna."}</p>

      {last && (
        <div className={cn("mt-4 rounded-md p-3 text-sm", last.diff === 0 ? "bg-ok-soft" : "bg-warn-soft")}>
          <b>{last.loc}</b> {last.diff === 0 ? "stämde med saldot." : `rättades ${last.diff > 0 ? "+" : ""}${last.diff} st.`} Skanna nästa hylla.
        </div>
      )}

      {p ? (
        <>
          <div className="mt-4 overflow-hidden rounded-md border bg-card">
            <div className="flex bg-sign text-sign-foreground">
              <div className="flex-1 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-75">Hyllplats</div>
                <div className="text-[44px] font-extrabold leading-none tracking-tight tabular-nums">{p.loc}</div>
              </div>
              <div className="border-l border-white/20 px-4 py-3 text-right">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-75">Saldo i appen</div>
                <div className="text-[40px] font-extrabold leading-none tabular-nums">{p.stock}</div>
              </div>
            </div>
            <div className="flex items-center gap-3.5 px-4 py-3.5">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded bg-muted text-muted-foreground"><Pict type={p.type} className="h-10 w-10" /></div>
              <div className="min-w-0">
                <div className="font-bold leading-tight">{p.name}</div>
                <div className="mt-1"><span className="rounded bg-accent px-1.5 py-0.5 font-bold text-accent-foreground">{p.variant}</span></div>
                <div className="mt-1 text-xs text-muted-foreground">{p.countedAt ? `Senast räknad ${new Date(p.countedAt).toLocaleDateString("sv-SE")}` : "Aldrig räknad"}</div>
              </div>
            </div>
            <div className="border-t px-4 py-3">
              <div className="flex items-baseline gap-3">
                <span className="flex-1 text-sm text-muted-foreground">Räknat antal</span>
                <output className="text-4xl font-extrabold tabular-nums">{typed === "" ? "–" : counted}</output>
              </div>
              {diff != null && (
                <div className={cn("mt-1 text-right text-sm font-bold", diff === 0 ? "text-ok" : "text-destructive")}>
                  {diff === 0 ? "Stämmer med saldot" : `${diff > 0 ? "+" : ""}${diff} mot saldot`}
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map(c => (
              <Button key={c} variant="outline" className="h-14 text-2xl font-bold tabular-nums" onClick={() => key(c)}>{c}</Button>
            ))}
            <Button variant="outline" className="h-14 text-base font-semibold" onClick={() => key("<")} aria-label="Radera siffra">Radera</Button>
            <Button variant="outline" className="h-14 text-base font-semibold" onClick={() => setTyped("0")}>Tom hylla</Button>
          </div>

          {diff != null && diff !== 0 && (
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Kommentar, t.ex. stod på fel hylla" aria-label="Kommentar"
              className="mt-3 h-11 w-full rounded-md border bg-card px-3 text-base outline-none focus:border-ring" />
          )}
          <Button className="mt-3 h-12 w-full text-base font-bold" disabled={counted == null || busy} onClick={save}>Spara inventeringen</Button>
          <div className="mt-3 text-center"><button className="text-sm text-muted-foreground underline" onClick={() => { setSku(null); setTyped("") }}>Avbryt</button></div>
        </>
      ) : (
        <>
          <div className="mt-4 grid place-items-center rounded-md border-2 border-dashed px-4 py-8 text-center text-muted-foreground">
            <ClipboardCheck className="h-10 w-10" />
            <div className="mt-2 font-semibold text-foreground">Skanna hylletiketten</div>
            <div className="text-sm">Du kan också skanna en vara som står på hyllan.</div>
          </div>
          <ScanBar placeholder="Skanna hylla eller vara" hint="Rikta mot hylletiketten" onScan={onScan} onNoCamera={onNoCamera} focusKey={last?.loc} />
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted-foreground">Testa:</span>
            {(never[0] ?? all[0]) && <Chip onClick={() => onScan((never[0] ?? all[0]).loc)}>Hylla <code className="font-mono text-xs text-muted-foreground">{(never[0] ?? all[0]).loc}</code></Chip>}
            {rows.find(r => r.need > 0) && <Chip onClick={() => onScan(rows.find(r => r.need > 0)!.p.loc)}>Hylla som tar slut</Chip>}
          </div>

          <h2 className="mb-2 mt-8 text-[13px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Senast räknat</h2>
          {moves.some(m => m.kind === "inventering") ? (
            <div className="overflow-hidden rounded-md border bg-card">
              {moves.filter(m => m.kind === "inventering").slice(0, 6).map(m => {
                const q = products[m.sku]
                return (
                  <div key={m.id} className="grid grid-cols-[64px_1fr_auto] items-center gap-2.5 border-t px-3 py-2.5 text-sm first:border-t-0">
                    <span className="font-extrabold tabular-nums">{q?.loc}</span>
                    <span className="min-w-0"><span className="block truncate font-semibold">{q?.name}</span>
                      <span className="block truncate text-muted-foreground">{m.who} {time(m.at)}{m.note ? ` · ${m.note}` : ""}</span></span>
                    <span className={cn("font-bold tabular-nums", m.qty > 0 ? "text-ok" : "text-destructive")}>{m.qty > 0 ? `+${m.qty}` : m.qty}</span>
                  </div>
                )
              })}
            </div>
          ) : <p className="text-sm text-muted-foreground">{never.length} av {all.length} hyllplatser är inte räknade än.</p>}
        </>
      )}
    </main>
  )
}
