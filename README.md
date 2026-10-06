# NAYA — Twende Pamoja

Mfumo wa bodaboda na bajaji. Unajengwa phase moja baada ya nyingine; kila phase inakuwa mtandaoni (Railway) kabla ya inayofuata.

| Phase | Kipengele | Hali |
|---|---|---|
| 1 | API kwenye Railway + Supabase, `GET /health` | ✅ |
| 2 | Msingi: usalama, migrations, login (simu + password), dashboard ya ofisi | ✅ |
| 3 | Madereva: usajili, chombo, nyaraka, uthibitisho wa ofisi, logo ya NAYA | ✅ |
| 3.5 | App moja ya NAYA: abiria na dereva kwa akaunti moja, kuchagua na kubadili mode | ✅ |
| 4 | Maeneo (ramani ya ofisi), bei kwa kila chombo, makadirio ya nauli kwa abiria (GPS au orodha) | ✅ |
| 5+6 | Safari kamili: kuagiza, kumpata dereva, online/offline, kukubali, nimefika → anza → maliza, nyota, mapato, ukurasa wa Safari ofisini | ✅ |
| 7 | Realtime (papo hapo) na arifa za simu (Web Push), arifa ndani ya app, ofisi inajisasisha yenyewe | ✅ |
| 8 | Ada ya mwezi ya madereva, ramani ya live ya dereva, PIN ya safari, kushiriki safari, dharura (SOS) | ✅ sasa |
| 9 | Malipo kwa simu (M-Pesa, Airtel, Mixx/Tigo, HaloPesa) | |
| 10 | Msaidizi wa AI (Claude) unaotumia data halisi | |
| 11 | Ripoti, CSV, takwimu, ukaguzi wa usalama | |

## Muundo

```
src/server.ts          Inaanzisha server (PORT kutoka env, 0.0.0.0) na kuendesha migrations
src/app.ts             Fastify: helmet, CORS, rate limit, JWT, routes, kurasa
src/config/env.ts      Variables (inakataa kuanza kama za lazima hazipo)
src/db/                Pool ya Supabase + migration runner
src/routes/            /health, /api/auth/*, /api/account/*, /api/drivers/me/*, /api/locations, /api/fares/*, /api/rides/*, /api/driver/*, /api/admin/*
src/services/          Mantiki (users, auth, account, drivers, files, audit, places, fare-engine, rides)
src/middleware/        Uhakiki wa token na roles, makosa
database/migrations/   SQL (tables zote ziko kwenye schema "naya")
frontend/app/          App MOJA ya NAYA (abiria + dereva) — / na /dereva/ zinaelekeza hapa
frontend/admin/        Ofisi (admin)
frontend/shared/brand/ Logo ya NAYA (SVG) na icons za app (PNG)
tests/                 Tests za API
```

## App moja ya NAYA

Akaunti moja (namba ya simu) inatumika kama **Abiria** na **Dereva**:

1. Mtu anajisajili → anaulizwa **"Utatumiaje NAYA?"** → Abiria au Dereva.
2. `naya.users.active_mode` inahifadhi mode ya mwisho; akiingia tena, anafungua mode hiyo.
3. **Akaunti → Badili mode** — kubadili hakutengenezi akaunti mpya.
4. Kuchagua Dereva kwa mara ya kwanza kunafungua ombi la udereva (`naya.drivers`, hali `INCOMPLETE`);
   ofisi ikithibitisha (`APPROVED`), mtumiaji anaweza kupokea safari (phases zijazo).

Roles: `USER` (mtumiaji wa app), `ADMIN`, `SUPER_ADMIN` (ofisi). Ofisi haiingii kwenye app, na watumiaji hawaingii ofisini.

Majibu yote ya API: `{ "success": true, "data": ... }` au `{ "success": false, "message": "..." }`.

## Maeneo na nauli

- Ofisi inaweka **maeneo** kwenye ramani (`/admin/#/maeneo`) na **bei** kwa kila chombo (`/admin/#/bei`). Hakuna maeneo wala bei za kubuni.
- Nauli = `max(nauli ya chini, bei ya kuanzia + bei kwa km × umbali wa barabara)`, ikizungushwa juu (mf. TSh 100).
- Umbali wa barabara ≈ umbali wa moja kwa moja × kizidisho cha barabara (kawaida 1.3).
- Abiria anaanzia mahali alipo (GPS) au eneo la orodha; GPS lazima iwe ndani ya km 30 ya maeneo ya huduma.
- Ramani: Leaflet (kutoka npm, inatolewa na server hii) + picha za OpenStreetMap.

## Safari

```
SEARCHING → ACCEPTED → ARRIVED → IN_PROGRESS → COMPLETED
          ↘ NO_DRIVER (hakuna dereva ndani ya dakika 3)
          ↘ CANCELLED (abiria kabla ya safari kuanza, au ofisi)
Dereva akighairi baada ya kukubali → safari inarudi SEARCHING (dereva mwingine anatafutwa).
```

- **Kumpata dereva:** server inaendesha dispatch kila sekunde 3 (`src/server.ts`). Ombi linaenda kwa dereva aliyethibitishwa, aliye online,
  mwenye chombo sahihi, aliye karibu zaidi (ndani ya km 10). Ana sekunde 20 kukubali; akikataa au muda ukiisha, anayefuata anapewa.
- **Usalama wa data:** unique indexes zinazuia dereva au abiria kuwa na safari mbili zinazoendelea; dereva ana ombi moja tu linalosubiri;
  kukubali kunafanyika chini ya row lock (madereva wawili hawawezi kupata safari moja).
- **Nauli** inahesabiwa na server wakati wa kuagiza (haitoki kwenye app). Malipo kwa sasa ni taslimu.
- Kila badiliko la hali linaandikwa kwenye `naya.ride_status_history`.
- Mabadiliko yanafika papo hapo kupitia realtime (tazama chini). Mtandao ukikatika, app inarudi kuangalia kila sekunde 4 mpaka iunganike tena.

## Realtime na arifa (Phase 7)

- **Papo hapo:** app na ofisi zinafungua `GET /api/stream` (Server-Sent Events). Tiketi ya kuingia (`POST /api/stream/ticket`) inadumu sekunde 60
  na haiwezi kutumika kama token ya kawaida. Ujumbe una aina na `rideId` tu — data yenyewe inasomwa tena kupitia API (ambayo inakagua ruhusa).
- Server zaidi ya moja zinaambiana kupitia Postgres `LISTEN/NOTIFY` (channel `naya_events`), kwa hiyo hakuna huduma mpya inayohitajika.
- Kitone kwenye kona ya juu: kijani = realtime imeunganika.
- **Arifa za simu (Web Push):** dereva anaitwa ombi likiingia hata app ikiwa imefungwa; abiria anaarifiwa dereva akipatikana, akifika, n.k.
  Inahitaji https (Railway), Chrome kwenye Android, au app iliyosakinishwa (Add to Home Screen) kwenye iPhone.
  Mtumiaji anaiwasha kwenye **Akaunti → Arifa**. Arifa zote zinahifadhiwa pia kwenye `naya.notifications`.
- Funguo za push (VAPID) hutengenezwa mara moja tu: `npm run vapid-keys`. Bila funguo hizi, realtime inafanya kazi lakini arifa za simu zimezimwa.

## Ada ya mwezi ya madereva (Phase 8)

- Kila dereva analipa ada ya mwezi (mwanzo: **TSh 5,000 kwa siku 30**). Ofisi inabadilisha kiasi, siku za bure, siku za
  kuvumiliwa na maelekezo ya kulipa kwenye **Ofisi → Ada → Mipangilio ya ada**.
- Dereva mpya anapothibitishwa anapata siku 30 za bure. Madereva waliokuwa wamethibitishwa kabla ya Phase 8 walipewa siku 30 na migration 007.
- Ada ikiisha: siku 3 za kuvumiliwa (anaonywa kwenye app), kisha hawezi kwenda online wala kupewa maombi mpaka alipe.
  Safari inayoendelea haikatizwi. Anapata arifa siku 3 kabla na siku ada inapoisha.
- **Kurekodi malipo:** Ofisi → Madereva → dereva → *Ada ya mwezi* → Rekodi malipo (miezi 1–12, njia, namba ya muamala).
  Kiasi kinahesabiwa na mfumo. Namba moja ya muamala haiwezi kurekodiwa mara mbili. Kulipa mapema kunaongeza siku juu ya zilizobaki.
  Malipo yaliyokosewa yanabatilishwa (malipo ya mwisho tu) — hayafutwi, yanabaki kwenye historia.
- Hakuna malipo yanayorekodiwa yenyewe: Phase 9 itaunganisha malipo ya simu.

## Ramani ya live na usalama wa safari (Phase 8)

- **Ramani:** abiria anaona pikipiki ya dereva ikisogea na dakika za kufika. Dereva akiwa na safari, simu yake inatuma mahali kila sekunde 5
  (vinginevyo kila sekunde 20). Mahali pa dereva panaenda kwa abiria wa safari yake tu.
- **PIN ya safari:** kila safari ina PIN ya tarakimu 4 inayoonekana kwa abiria tu. Dereva anaiingiza kuanza safari. Ikikosewa mara 5,
  safari haiwezi kuanzishwa (ofisi inaona kwenye ukurasa wa safari).
- **Shiriki safari:** abiria anatuma link (`/safari/#…`) kwa ndugu; inaonyesha dereva, plate na ramani bila kuingia, bila namba za simu,
  na inakufa saa 2 baada ya safari kuisha. Database inahifadhi SHA-256 ya link tu.
- **Dharura (SOS):** abiria au dereva anabonyeza *Dharura* → ofisi inaona bango jekundu na kengele papo hapo (Ofisi → Dharura),
  pamoja na namba za simu za wote wawili na mahali. App pia ina kitufe cha kupiga Polisi (112).

## Nyaraka za madereva

Picha na PDF za nyaraka zinahifadhiwa ndani ya Supabase (table `naya.document_files`), kwa hiyo hazipotei Railway ikideploy upya.
App ya dereva inapunguza picha (upande mrefu 1600px, JPEG) kabla ya kutuma; mwisho ni MB 3 kwa faili.
Server inahakiki aina halisi ya faili kutoka kwenye bytes zake (JPG, PNG, WEBP, PDF tu).

## Kwenye kompyuta yako (PowerShell)

```
npm install
copy .env.example .env          # weka DATABASE_URL na JWT_SECRET halisi
npm run create-admin -- 0712345678 "Jina Kamili" "PasswordNdefu123"
npm run dev                     # app: http://localhost:8080/app/   ofisi: http://localhost:8080/admin/
```

`create-admin` ikitumika tena kwa namba ile ile, inabadilisha password na kutoa vifaa vyote vilivyoingia.

Tests (kwenye database ya majaribio tu, kamwe ya production): `npm test`

## Railway

- Build: `npm run build` · Start: `npm start` (tayari kwenye `railway.json`)
- Variables za lazima: `DATABASE_URL` (Supabase Session pooler, port 5432) na `JWT_SECRET`
- Kwa arifa za simu: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (kutoka `npm run vapid-keys`; usizibadilishe baadaye, la sivyo simu zote zitahitaji kuwasha arifa upya)
- Migrations zinaendeshwa zenyewe server inapoanza
- Hakikisha: `/health` → `{"success":true,"status":"ok","database":"ok"}`, kisha `/admin/`
