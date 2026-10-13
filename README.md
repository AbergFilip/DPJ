# DPJ Plock

Mobil plockapp för DPJ:s lager. Plockaren tar en order ur kön, går plocklistan i gångordning, skannar hylla och vara, får varning vid fel variant, rapporterar avvikelser med foto och skickar ordern till pack.

All data är påhittad. Inget kommer från DPJ:s system.

## Köra lokalt

```bash
pnpm install
pnpm dev
```

Utan `.env` körs appen i lokalt läge (data i webbläsaren). Med värdena i `.env.example` kopplar den mot Supabase och kön delas live mellan alla mobiler.

## Publicera

Appen är en statisk PWA. Bygg med `pnpm build` och lägg ut `dist/` på valfri statisk host, till exempel Vercel eller Netlify (importera repot, byggkommando `pnpm build`, mapp `dist`). `.env.production` innehåller Supabase-adressen och den publika nyckeln.

Kameran kräver https, vilket Vercel och Netlify ger automatiskt.

## Databas

Schema, funktioner och demodata ligger i `supabase/migrations/`. Alla skrivningar går via funktioner som kontrollerar att plockaren äger ordern, så två plockare kan inte ta samma order.

Inloggningen är simulerad: man väljer namn och skriver PIN 1234. Plockare (Sara, Amir, Jonna, Mikael) ser plockappen, arbetsledaren (Lena) ser även översikten på `/admin.html`. Allt kontrolleras bara i webbläsaren. Innan riktig drift behövs Supabase Auth och att funktionerna läser användaren från inloggningen i stället för från anropet.

## Teknik

React, TypeScript, Vite, Tailwind, shadcn/ui, Supabase (databas, realtid, fillagring), zxing (streckkoder via kameran), vite-plugin-pwa.

## Orderimport

Arbetsledaren kan importera order från en CSV-fil i översikten (`/admin.html`). En rad per orderrad, separerad med semikolon:

```
ordernr;kund;frakt;klart_senast;artikelnr;antal
```

`frakt` som börjar med "Express" blir expressorder, allt annat PostNord. Order som redan finns hoppas över. `public/demo-order.csv` är en påhittad exempelfil. När DPJ:s ordersystem kan exportera filen behöver bara kolumnnamnen matchas.

## Inleverans och saldo

Varje artikel har en hyllplats och ett saldo. Under fliken Inleverans skannar man varan (en gång per styck, eller ändra antalet), och sedan hyllan för att ställa in den. Plock drar en från saldot per skannad vara. En avvikelse av typen "Saknas" eller "Fel saldo" nollar saldot, eftersom hyllan då är tom. Fliken Saldo visar saldo, hur mycket som ligger i kön och om det räcker. Översikten visar samma sak och de senaste lagerrörelserna.

## Plockrunda

I kön kan plockaren välja upp till fyra order med "Lägg i runda" och starta dem tillsammans. Plocklistan slår ihop alla rader i gångordning och visar för varje rad vilken låda (order) varan ska i. När allt är plockat skickas alla order till pack på en gång. Databasfunktionen `claim_orders` tar alla order eller ingen, så två plockare kan inte dela på en runda.

## Packstation

Fliken Pack är sista steget. Packaren skannar ordernumret på plocklådan (streckkoder för demon finns på `/etiketter.html`), skannar varorna en i taget som kontroll och väger kollit. Knappen "Lägg på vågen" simulerar en våg utifrån artiklarnas vikt, och appen varnar om vikten skiljer mer än tio procent från förväntat. Sedan skrivs packsedeln ut, med restnoterade rader för det som saknades. Ordern får status "Skickad". Databasfunktionen `pack_order` sparar vikt, packare och tid.

## Inventering och påfyllnad

Fliken Saldo börjar med "Att fylla på": artiklar där saldot inte räcker till orderna i kön plus ett min-saldo kvar på hyllan. Siffran visas också som en bricka på fliken, så plockaren ser det utan att leta. "Fyll på" tar personen vidare till inleveransen med artikeln förvald. "Räkna" öppnar inventeringen: skanna hyllan (eller en vara som står där), slå in antalet på knappsatsen och se direkt skillnaden mot saldot. Sparandet rättar saldot och loggar skillnaden som en lagerrörelse av typen Inventering, med kommentar. Översikten visar hur mycket som behöver fyllas på och när varje hyllplats senast räknades. Databasfunktionen är `count_stock`.

## Utan nät

Appens filer cachas i mobilen (PWA), och senaste kända orderläget sparas lokalt. Tappar mobilen täckningen fortsätter plocket mot den lokala kopian: varje skanning sparas i en kö i mobilen och en gul rad visar hur många ändringar som väntar. När nätet är tillbaka skickas de i ordning. Om någon annan hann ta samma order under tiden sparas inte den ändringen, och plockaren får ett meddelande. Reglerna för plock finns i `src/ops.ts` och används både i demoläget och utan nät.
