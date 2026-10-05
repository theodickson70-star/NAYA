# Urambo Ride API

Msingi mdogo unaofanya kazi. Tunaongeza kipande kimoja kwa wakati, kila kimoja kikiwa mtandaoni kabla ya kingine.

| Hatua | Kipengele | Hali |
|---|---|---|
| 1 | API kwenye Railway + Supabase, `GET /health` | ⬅ sasa |
| 2 | Login ya admin + dashboard ndogo | |
| 3 | Dispatcher anaingiza oda na kumpangia dereva | |
| 4 | App ya dereva | |

## Mafaili

```
src/config.ts   Variables (DATABASE_URL, PORT)
src/db.ts       Muunganisho na Supabase
src/server.ts   Server + /health
src/dashboard.ts Ukurasa wa hali ya mfumo (http://localhost:4000)
```

## Kwenye kompyuta yako

```
npm install
copy .env.example .env      # weka DATABASE_URL yako halisi
npm run dev                 # fungua http://localhost:4000
```

## Railway

- Build: `npm run build` · Start: `npm start` (tayari kwenye `railway.json`)
- Variable moja tu: `DATABASE_URL` = Supabase **Session pooler** (port 5432)
- Hakikisha: `https://<app>.up.railway.app/health` → `{"ok":true,"database":"ok"}`
