// Utskrivbara demoetiketter: hyllplats (Code 128) och vara (EAN-13) för varje demoartikel, i gångordning.
import JsBarcode from "jsbarcode"
import "./index.css"
import { SEED_PRODUCTS, seedOrders } from "./data"

const products = Object.values(SEED_PRODUCTS).sort((a, b) => a.loc.localeCompare(b.loc, "sv", { numeric: true }))
const root = document.getElementById("root")!
root.className = "mx-auto max-w-5xl px-4 py-6 print:p-0"
root.innerHTML = `
  <header class="mb-6 flex flex-wrap items-end gap-4 print:hidden">
    <div class="min-w-0 flex-1">
      <h1 class="text-3xl font-extrabold tracking-tight">Streckkoder för demon</h1>
      <p class="mt-1 max-w-2xl text-muted-foreground">Visa sidan på datorn eller skriv ut den. Öppna appen i mobilen, starta en order, tryck på kameraknappen och rikta mobilen mot koden. Skanna först hyllan och sedan varan. Prova att skanna en annan variant för att se varningen.</p>
    </div>
    <a href="/" class="rounded-md bg-primary px-4 py-2.5 font-bold text-primary-foreground">Till appen</a>
  </header>
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2 print:gap-2">
    ${products.map(p => `
      <section class="break-inside-avoid rounded-md border bg-card p-4">
        <div class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Hyllplats</div>
        <div class="text-4xl font-extrabold leading-none">${p.loc}</div>
        <svg class="mt-2 h-auto w-full" data-code="${p.loc}" data-format="CODE128"></svg>
        <hr class="my-3" />
        <div class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">${p.brand ?? "Vara"}</div>
        <div class="font-semibold leading-tight">${p.name}</div>
        <div class="text-sm"><span class="rounded bg-accent px-1 font-bold text-accent-foreground">${p.variant}</span></div>
        <svg class="mt-2 h-auto w-full" data-code="${p.ean}" data-format="EAN13"></svg>
      </section>`).join("")}
  </div>
  <h2 class="mb-1 mt-10 text-2xl font-extrabold tracking-tight">Order till packstationen</h2>
  <p class="mb-4 max-w-2xl text-muted-foreground">I skarp drift sitter ordernumret på plocklådan eller plocklistan. Skanna det i fliken Pack när ordern är plockad.</p>
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-3 print:gap-2">
    ${seedOrders().sort((a, b) => a.id.localeCompare(b.id)).map(o => `
      <section class="break-inside-avoid rounded-md border bg-card p-4">
        <div class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Order</div>
        <div class="text-2xl font-extrabold leading-none">#${o.id}</div>
        <div class="truncate text-sm text-muted-foreground">${o.cust}</div>
        <svg class="mt-2 h-auto w-full" data-code="${o.id}" data-format="CODE128"></svg>
      </section>`).join("")}
  </div>
  <p class="mt-6 text-sm text-muted-foreground">Påhittade artiklar och koder, bara för demo.</p>`

root.querySelectorAll<SVGSVGElement>("svg[data-code]").forEach(el =>
  JsBarcode(el, el.dataset.code!, { format: el.dataset.format, displayValue: true, margin: el.dataset.format === "EAN13" ? 24 : 12, width: 3, height: 90, fontSize: 18, background: "#ffffff", lineColor: "#000000" }))
