# PayPoint — Kituo Chako cha Pesa

Mfumo wa web wa usimamizi wa biashara ya uwakala wa kutuma na kutoa pesa (M-Pesa, Mixx by Yas, Airtel Money, HaloPesa, T-Pesa).
Unafanya kazi kwenye simu na kompyuta. Lugha: Kiswahili.

**DUKALANGU SOLUTION GROUP** · Bomavillage, Urambo – Tabora

## Teknolojia
- Node.js 20+ · TypeScript · Fastify (kurasa zinatengenezwa na server, JavaScript kidogo tu)
- PostgreSQL ya **Supabase ileile ya NAYA** — majedwali yote yako kwenye schema `paypoint` (schema `naya` haiguswi)
- Railway (kila `git push` inaweka toleo jipya)
- Rangi na fonti za NAYA (kijani #0A6E47, dhahabu #F2B705; Bricolage Grotesque + Atkinson Hyperlegible)

## Watumiaji
| | Mmiliki (owner) | Mfanyakazi (agent) |
|---|---|---|
| Kusajili duka, kuongeza/kuzima wafanyakazi | ✔ | |
| Float na cash ya duka | ✔ (pekee) | anaona salio tu |
| Tuma / Toa | | ✔ |
| Miamala | anaona yote | anaona **yake tu** |
| Kubatilisha muamala | ✘ | wake tu, siku hiyo hiyo, kwa sababu |
| Ripoti | zote, kwa mfanyakazi / duka / mtandao | zake |
| Kumbukumbu (audit log), arifa, kamisheni, maduka | ✔ | |

## Kurasa
`/sajili` (sajili duka) · `/ingia` · `/toka` · `/` dashibodi · `/tuma` · `/toa` · `/risiti/<id>` ·
`/wateja` · `/wafanyakazi` · `/wafanyakazi/ongeza` · `/wafanyakazi/<id>/badilisha` · `/float` · `/maduka` ·
`/kamisheni` · `/ripoti` (+ `/ripoti.csv`) · `/hesabu` · `/kumbukumbu` · `/arifa` · `/akaunti`

## Hesabu (kama uwakala halisi)
| Tukio | Cash ya duka | Float ya mtandao |
|---|---|---|
| **Tuma** (mteja analeta cash, wakala anatuma) | + kiasi | − kiasi |
| **Toa** (mteja anatuma kwa wakala, anapewa cash) | − kiasi | + kiasi |
| Float imeingia / imetolewa (mmiliki) | | + / − |
| Cash imeingia / imechukuliwa / matumizi (mmiliki) | + / − / − | |
| Kununua float / kuuza float | − / + | + / − |

- Kila duka lina **cash** na **float ya kila mtandao** wake. Muamala unakataliwa kama float (tuma) au cash (toa) haitoshi.
- **Kamisheni:** chaguo-msingi Tuma 1%, Toa 1.5%, angalau TSh 100 (inabadilishwa kwenye `/kamisheni`). Ngazi (tiers) za mtandao zikiwekwa, zinatumika badala ya asilimia.
- Salio la M-Pesa la mteja haliko kwenye PayPoint (liko kwa mtandao wake). Wateja wanahifadhiwa kama daftari: jina, simu na historia; mteja mpya anasajiliwa yenyewe kwenye muamala.
- **Hesabu ya siku:** mfanyakazi anaandika cash na float halisi; mfumo unalinganisha na kumjulisha mmiliki kukiwa na upungufu.

## Usalama
- Password zimehifadhiwa kwa bcrypt; vikao kwa cookie `HttpOnly` + `Secure` (hash ya token ndiyo inayohifadhiwa)
- CSRF token kwenye kila fomu; kikomo cha majaribio ya kuingia (10 kwa dakika 10)
- Mfanyakazi aliyezimwa anatolewa kwenye mfumo papo hapo
- **Miamala na kumbukumbu haziwezi kufutwa** — database yenyewe inazuia (triggers)
- Kila kitendo kinarekodiwa kwenye kumbukumbu (pamoja na majaribio ya kuingia yaliyoshindwa)
- Hakuna stack trace kwa mtumiaji; siri ziko kwenye environment variables tu

## Kuweka kwenye Railway (service ileile ya NAYA)
1. **Variables:** acha `DATABASE_URL` ya Supabase ilivyo. Ondoa variables zisizohitajika (k.m. `SUPABASE_URL`, `SUPABASE_ANON_KEY`) baada ya kuzihifadhi mahali salama. Usiweke `COOKIE_SECURE`.
2. **Settings:** futa Build/Start Command zilizoandikwa kwa mkono — `railway.json` inaziweka (`npm run build`, `npm start`, healthcheck `/afya`).
3. `git push` — server ikianza inaunda majedwali ya `paypoint` yenyewe (migrations).
4. Fungua link ya Railway (au domain yako: Settings → Networking → Custom Domain) → **Sajili duka**.

## Kwenye kompyuta yako
```powershell
copy .env.example .env   # weka DATABASE_URL yako
npm install
npm run dev
```
Majaribio (database ya majaribio, si ya kazi): `DATABASE_URL=... COOKIE_SECURE=false npm test`

Code ya NAYA imehifadhiwa kwenye GitHub kama tag `naya-final`.
