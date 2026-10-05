# NAYA — Twende Pamoja

Mfumo wa bodaboda na bajaji. Unajengwa phase moja baada ya nyingine; kila phase inakuwa mtandaoni (Railway) kabla ya inayofuata.

| Phase | Kipengele | Hali |
|---|---|---|
| 1 | API kwenye Railway + Supabase, `GET /health` | ✅ |
| 2 | Msingi: usalama, migrations, login (simu + password), dashboard ya ofisi | ✅ |
| 3 | Madereva: usajili, chombo, nyaraka, uthibitisho wa ofisi, logo ya NAYA | ✅ sasa |
| 4 | Bei (fare rules) na maeneo | |
| 5 | Safari: kuomba, kumpata dereva, hali za safari, app ya mteja | |
| 6 | App ya dereva: online, maombi, mapato | |
| 7 | Realtime (Supabase Realtime) na notifications | |
| 8 | Malipo kwa simu (M-Pesa, Airtel, Tigo, HaloPesa) | |
| 9 | Msaidizi wa AI (Claude) unaotumia data halisi | |
| 10 | Ripoti, CSV, takwimu, ukaguzi wa usalama | |

## Muundo

```
src/server.ts          Inaanzisha server (PORT kutoka env, 0.0.0.0) na kuendesha migrations
src/app.ts             Fastify: helmet, CORS, rate limit, JWT, routes, kurasa
src/config/env.ts      Variables (inakataa kuanza kama za lazima hazipo)
src/db/                Pool ya Supabase + migration runner
src/routes/            /health, /api/auth/*, /api/drivers/*, /api/admin/*
src/services/          Mantiki (users, auth, drivers, files, audit)
src/middleware/        Uhakiki wa token na roles, makosa
database/migrations/   SQL (tables zote ziko kwenye schema "naya")
frontend/              Kurasa: / (mwanzo), /admin/ (ofisi), /dereva/ (app ya dereva)
frontend/shared/brand/ Logo ya NAYA (SVG) na icons za app (PNG)
tests/                 Tests za API
```

Majibu yote ya API: `{ "success": true, "data": ... }` au `{ "success": false, "message": "..." }`.

## Nyaraka za madereva

Picha na PDF za nyaraka zinahifadhiwa ndani ya Supabase (table `naya.document_files`), kwa hiyo hazipotei Railway ikideploy upya.
App ya dereva inapunguza picha (upande mrefu 1600px, JPEG) kabla ya kutuma; mwisho ni MB 3 kwa faili.
Server inahakiki aina halisi ya faili kutoka kwenye bytes zake (JPG, PNG, WEBP, PDF tu).

## Kwenye kompyuta yako (PowerShell)

```
npm install
copy .env.example .env          # weka DATABASE_URL na JWT_SECRET halisi
npm run create-admin -- 0712345678 "Jina Kamili" "PasswordNdefu123"
npm run dev                     # ofisi: http://localhost:8080/admin/  dereva: http://localhost:8080/dereva/
```

`create-admin` ikitumika tena kwa namba ile ile, inabadilisha password na kutoa vifaa vyote vilivyoingia.

Tests (kwenye database ya majaribio tu, kamwe ya production): `npm test`

## Railway

- Build: `npm run build` · Start: `npm start` (tayari kwenye `railway.json`)
- Variables za lazima: `DATABASE_URL` (Supabase Session pooler, port 5432) na `JWT_SECRET`
- Migrations zinaendeshwa zenyewe server inapoanza
- Hakikisha: `/health` → `{"success":true,"status":"ok","database":"ok"}`, kisha `/admin/`
