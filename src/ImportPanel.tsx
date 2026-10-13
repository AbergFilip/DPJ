// Import av order från CSV i översikten. Visar en förhandsgranskning innan något sparas.
import { useRef, useState } from "react"
import { FileUp, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Products } from "./data"
import { CSV_COLUMNS, parseOrdersCsv, type NewOrder, type ParsedCsv } from "./csv"

export default function ImportPanel({ products, existing, onImport }: {
  products: Products; existing: Set<string>; onImport: (orders: NewOrder[]) => Promise<number>
}) {
  const [file, setFile] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const read = (name: string, text: string) => { setFile(name); setParsed(parseOrdersCsv(text, products)); setResult(null) }
  const fresh = parsed?.orders.filter(o => !existing.has(o.id)) ?? []

  async function save() {
    setBusy(true)
    try {
      const n = await onImport(fresh)
      setResult(`${n} order importerade. De ligger nu i plockkön.`); setParsed(null); setFile(null)
    } catch (e) { setResult(`Importen misslyckades: ${e instanceof Error ? e.message : String(e)}`) }
    finally { setBusy(false) }
  }

  return (
    <div className="p-4">
      <p className="text-sm text-muted-foreground">
        En rad per orderrad, separerad med semikolon. Kolumner: <code className="font-mono text-xs">{CSV_COLUMNS.join(";")}</code>.
        Order som redan finns hoppas över.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => input.current?.click()}><FileUp />Välj CSV-fil</Button>
        <Button variant="outline" onClick={async () => read("demo-order.csv", await (await fetch("/demo-order.csv")).text())}>Testa med demofilen</Button>
        <a href="/demo-order.csv" download className="text-sm text-muted-foreground underline">Ladda ner demofilen</a>
        <input ref={input} type="file" accept=".csv,text/csv" hidden
          onChange={async e => { const f = e.target.files?.[0]; if (f) read(f.name, await f.text()); e.target.value = "" }} />
      </div>

      {result && <p className={cn("mt-3 rounded-md px-3 py-2 text-sm", result.startsWith("Importen") ? "bg-bad-soft text-destructive" : "bg-ok-soft text-ok")}>{result}</p>}

      {parsed && (
        <div className="mt-4">
          <div className="text-sm font-semibold">{file}</div>
          {parsed.errors.length > 0 && (
            <ul className="mt-2 list-disc rounded-md bg-bad-soft py-2 pl-8 pr-3 text-sm text-destructive">
              {parsed.errors.map(e => <li key={e}>{e}</li>)}
            </ul>
          )}
          {parsed.orders.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b"><th className="py-2 pr-2">Order</th><th className="px-2 py-2">Kund</th><th className="px-2 py-2">Frakt</th><th className="px-2 py-2">Klart senast</th><th className="px-2 py-2">Rader</th><th className="px-2 py-2">Kolli</th><th className="py-2 pl-2" /></tr>
                </thead>
                <tbody>
                  {parsed.orders.map(o => (
                    <tr key={o.id} className={cn("border-b last:border-0", existing.has(o.id) && "text-muted-foreground")}>
                      <td className="py-2 pr-2 font-bold tabular-nums">{o.id}</td>
                      <td className="px-2 py-2">{o.cust}</td>
                      <td className="px-2 py-2">{o.shipTxt}</td>
                      <td className="px-2 py-2 tabular-nums">{o.due}</td>
                      <td className="px-2 py-2 tabular-nums">{o.lines.length}</td>
                      <td className="px-2 py-2 tabular-nums">{o.lines.reduce((n, l) => n + l.qty, 0)}</td>
                      <td className="py-2 pl-2 text-right text-xs">{existing.has(o.id) ? "Finns redan, hoppas över" : <span className="font-semibold text-ok">Ny</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Button disabled={!fresh.length || busy} onClick={save}><Upload />Importera {fresh.length} order</Button>
            <Button variant="ghost" onClick={() => { setParsed(null); setFile(null) }}>Avbryt</Button>
          </div>
        </div>
      )}
    </div>
  )
}
