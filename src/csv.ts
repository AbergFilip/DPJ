// Läser order från en CSV-export. En rad per orderrad: ordernr;kund;frakt;klart_senast;artikelnr;antal
import type { Products } from "./data"

export interface NewOrder { id: string; cust: string; ship: "exp" | "std"; shipTxt: string; due: string; lines: { sku: string; qty: number }[] }
export interface ParsedCsv { orders: NewOrder[]; errors: string[] }

export const CSV_COLUMNS = ["ordernr", "kund", "frakt", "klart_senast", "artikelnr", "antal"]

export function parseOrdersCsv(text: string, products: Products): ParsedCsv {
  const rows = text.replace(/^﻿/, "").split(/\r?\n/).filter(r => r.trim())
  const errors: string[] = []
  if (!rows.length) return { orders: [], errors: ["Filen är tom."] }
  const sep = rows[0].includes(";") ? ";" : ","
  const split = (r: string) => r.split(sep).map(c => c.trim().replace(/^"(.*)"$/, "$1").trim())
  const head = split(rows[0]).map(h => h.toLowerCase())
  const idx = CSV_COLUMNS.map(c => head.indexOf(c))
  const missing = CSV_COLUMNS.filter((_, k) => idx[k] < 0)
  if (missing.length) return { orders: [], errors: [`Kolumner saknas: ${missing.join(", ")}.`] }

  const byId = new Map<string, NewOrder>()
  rows.slice(1).forEach((r, k) => {
    const [id, cust, frakt, due, sku, antal] = idx.map(i => split(r)[i] ?? "")
    const at = `Rad ${k + 2}`
    const qty = Number(antal)
    if (!id || !cust) { errors.push(`${at}: ordernr och kund måste finnas.`); return }
    if (!products[sku]) { errors.push(`${at}: okänt artikelnummer ${sku || "(tomt)"}.`); return }
    if (!Number.isInteger(qty) || qty < 1) { errors.push(`${at}: antal måste vara ett heltal över noll.`); return }
    if (!/^\d{1,2}:\d{2}$/.test(due)) { errors.push(`${at}: klart_senast ska skrivas som 15:00.`); return }
    const exp = frakt.toLowerCase().startsWith("exp")
    const o = byId.get(id) ?? { id, cust, ship: exp ? "exp" : "std", shipTxt: exp ? "Express Stockholm" : "PostNord", due: due.padStart(5, "0"), lines: [] }
    byId.set(id, o)
    const same = o.lines.find(l => l.sku === sku)
    if (same) same.qty += qty; else o.lines.push({ sku, qty })
  })
  return { orders: [...byId.values()], errors }
}
