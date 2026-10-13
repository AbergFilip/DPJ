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

Inloggning saknas i prototypen: plockaren väljs i listan. Innan riktig drift behövs inloggning per plockare (Supabase Auth) och att funktionerna läser plockaren från inloggningen i stället för från anropet.

## Teknik

React, TypeScript, Vite, Tailwind, shadcn/ui, Supabase (databas, realtid, fillagring), zxing (streckkoder via kameran), vite-plugin-pwa.
