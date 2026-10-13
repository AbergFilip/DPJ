// Typer, hjälpfunktioner och demodata för lokalt läge. Allt är påhittat, inget kommer från DPJ:s system.

export type ProductType = "skiva" | "stativ" | "hurts" | "stol" | "vagg" | "arm" | "ranna" | "fot"
export interface Product { sku: string; name: string; variant: string; ean: string; loc: string; type: ProductType; brand?: string | null; stock: number; minStock: number; countedAt?: number | null }
export interface Deviation { kind: DeviationKind; found: number; note: string; photo: string | null }
export type DeviationKind = "Saknas" | "Skadad" | "Fel saldo"
export interface Line { id: string; sku: string; qty: number; picked: number; locOk: boolean; dev: Deviation | null }
export type Status = "ny" | "plock" | "pack" | "avv" | "skickad"
export interface Order {
  id: string; cust: string; ship: "exp" | "std"; shipTxt: string; due: string; status: Status
  lines: Line[]; picker?: string | null; startedAt?: number | null; doneAt?: number | null
  packer?: string | null; packedAt?: number | null; weight?: number | null
}
export type Products = Record<string, Product>
export interface StockMove { id: string; sku: string; qty: number; kind: "in" | "plock" | "avvikelse" | "inventering"; who: string | null; note: string | null; at: number }
export interface Snapshot { products: Products; orders: Order[]; moves: StockMove[] }

export const DEVIATION_KINDS: DeviationKind[] = ["Saknas", "Skadad", "Fel saldo"]

const P = (sku: string, name: string, variant: string, ean: string, loc: string, type: ProductType, brand: string | undefined, stock: number, minStock: number): Product =>
  ({ sku, name, variant, ean, loc, type, brand, stock, minStock })

export const SEED_PRODUCTS: Products = Object.fromEntries([
  P("BRZ-SK-1680-VI", "Bordsskiva Professional", "160×80 cm, vit", "7340001216806", "A-03-2", "skiva", "Brizley", 14, 4),
  P("BRZ-SK-1680-EK", "Bordsskiva Professional", "160×80 cm, ek", "7340001216813", "A-03-3", "skiva", "Brizley", 5, 4),
  P("BRZ-SK-1890-AN", "Bordsskiva Professional", "180×90 cm, antracit", "7340001218909", "A-05-1", "skiva", "Brizley", 3, 2),
  P("BRZ-ST-EL2-SV", "Elstativ Professional, 2 motorer", "svart, för 160–180 cm", "7340001302219", "B-02-1", "stativ", "Brizley", 1, 4),
  P("BRZ-ST-EL2-VI", "Elstativ Professional, 2 motorer", "vit, för 160–180 cm", "7340001302226", "B-02-2", "stativ", "Brizley", 6, 4),
  P("HU-3L-VI", "Hurts 3 lådor, låsbar", "vit", "7340001455106", "C-06-2", "hurts", undefined, 9, 3),
  P("KS-ERGO-SV", "Kontorsstol Ergo Plus", "svart tyg", "7340001501209", "C-11-1", "stol", undefined, 18, 6),
  P("SV-160-GR", "Skärmvägg bordsmonterad", "160 cm, grå filt", "7340001604306", "D-04-3", "vagg", undefined, 2, 4),
  P("MA-DUO-SV", "Skärmarm dubbel", "svart", "7340001700107", "E-01-4", "arm", undefined, 11, 4),
  P("KR-140-SV", "Kabelränna", "140 cm, svart", "7340001714005", "E-02-1", "ranna", undefined, 25, 10),
  P("FS-ERGO", "Fotstöd, justerbart", "svart", "7340001720600", "E-03-2", "fot", undefined, 7, 4),
].map(p => [p.sku, p]))

export const seedOrders = (): Order[] => {
  const L = (order: string, sku: string, qty: number, extra: Partial<Line> = {}): Line =>
    ({ id: `${order}-${sku}`, sku, qty, picked: 0, locOk: false, dev: null, ...extra })
  const ago = (m: number) => Date.now() - m * 60000
  return [
    { id: "100481", cust: "Nordvik Redovisning AB", ship: "exp", shipTxt: "Express Stockholm", due: "11:30", status: "ny",
      lines: [L("100481", "BRZ-SK-1680-VI", 2), L("100481", "BRZ-ST-EL2-SV", 2), L("100481", "KR-140-SV", 2)] },
    { id: "100484", cust: "Studio Hägg & Co", ship: "exp", shipTxt: "Express Stockholm", due: "11:45", status: "ny",
      lines: [L("100484", "BRZ-SK-1890-AN", 1), L("100484", "BRZ-ST-EL2-SV", 1), L("100484", "HU-3L-VI", 1), L("100484", "SV-160-GR", 1)] },
    { id: "100482", cust: "Lindqvist Arkitekter", ship: "std", shipTxt: "PostNord", due: "15:00", status: "ny",
      lines: [L("100482", "BRZ-SK-1680-EK", 1), L("100482", "BRZ-ST-EL2-VI", 1), L("100482", "MA-DUO-SV", 1)] },
    { id: "100483", cust: "Fjällgren Fastigheter", ship: "std", shipTxt: "PostNord", due: "15:00", status: "plock", picker: "Amir", startedAt: ago(6),
      lines: [L("100483", "KS-ERGO-SV", 4, { picked: 2, locOk: true }), L("100483", "FS-ERGO", 4)] },
    { id: "100485", cust: "Berglund Tandvård", ship: "std", shipTxt: "PostNord", due: "15:00", status: "ny",
      lines: [L("100485", "HU-3L-VI", 2), L("100485", "SV-160-GR", 2)] },
    { id: "100480", cust: "Öberg Konsult", ship: "std", shipTxt: "PostNord", due: "15:00", status: "avv", picker: "Jonna", startedAt: ago(52), doneAt: ago(41),
      lines: [L("100480", "BRZ-SK-1680-EK", 1, { picked: 1, locOk: true }),
        L("100480", "BRZ-ST-EL2-SV", 1, { locOk: true, dev: { kind: "Saknas", found: 0, note: "Tom plats B-02-1", photo: null } })] },
    { id: "100479", cust: "Kvarnström Media", ship: "exp", shipTxt: "Express Stockholm", due: "10:00", status: "pack", picker: "Amir", startedAt: ago(75), doneAt: ago(66),
      lines: [L("100479", "KS-ERGO-SV", 2, { picked: 2, locOk: true }), L("100479", "MA-DUO-SV", 2, { picked: 2, locOk: true })] },
  ]
}

// Ungefärlig vikt per vara i kg, för packstationens simulerade våg och kontrollvägning.
export const WEIGHT_KG: Record<ProductType, number> = { skiva: 21, stativ: 24, hurts: 19, stol: 15, vagg: 5.5, arm: 3.8, ranna: 1.1, fot: 1.6 }
export const PACKAGING_KG = 1.2
export const expectedWeight = (o: Order, products: Products) =>
  Math.round((PACKAGING_KG + o.lines.reduce((n, l) => n + l.picked * (WEIGHT_KG[products[l.sku]?.type] ?? 1), 0)) * 10) / 10

export const lineDone = (l: Line) => l.picked >= l.qty || !!l.dev
export const kolli = (o: Order) => o.lines.reduce((n, l) => n + l.qty, 0)
export const mins = (ms: number) => Math.max(1, Math.round(ms / 60000))
export const sortByLoc = <T extends Line>(lines: T[], products: Products) =>
  [...lines].sort((a, b) => (products[a.sku]?.loc ?? "").localeCompare(products[b.sku]?.loc ?? "", "sv", { numeric: true }))

// Hur många av varje artikel som ligger i order som ännu inte är plockade.
export const reserved = (orders: Order[]) => {
  const r: Record<string, number> = {}
  for (const o of orders) if (o.status === "ny" || o.status === "plock")
    for (const l of o.lines) if (!l.dev) r[l.sku] = (r[l.sku] ?? 0) + l.qty - l.picked
  return r
}
