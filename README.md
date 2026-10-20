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
| 8 | Ada ya mwezi ya madereva, ramani ya live ya dereva, PIN ya safari, kushiriki safari, dharura (SOS) | ✅ |
| 9 | SMS (Beem): kuthibitisha namba ya simu, "Umesahau password?", SMS za taarifa muhimu | ✅ |
| 9.5 | Muonekano mpya: animation ya logo wakati wa kufungua, utangulizi wa slaidi 3, skrini mpya za kuingia na kila skrini ya app | ✅ |
| 10 | App ya Android (APK): kengele ya ombi ya sekunde 30 hata app ikiwa imefungwa (Firebase), inajengwa na GitHub Actions | ✅ |
| 10.1 | Bei maalum kati ya maeneo (ofisi inaandika bei za njia; km kwa nyingine) | ✅ |
| 10.2 | Dereva anaweza kwenda online popote (anapokea maombi ya wateja walio ndani ya km 10 tu) | ✅ |
| 11 | Ofisi kuu: wateja, msaada (malalamiko), ramani live, kuingilia safari, matangazo, ripoti + CSV, utafutaji mmoja | ✅ |
| 11.1 | Maoni: abiria na madereva wanatoa nyota + maoni kwenye Akaunti; ofisi inayafanyia kazi na mtoaji anajulishwa | ✅ |
| 11.2 | Masharti ya huduma (abiria + dereva) na sera ya faragha; kukubali wakati wa kujisajili, kutuma ombi la udereva, na kwa watumiaji wa zamani | ✅ |
| 12 | Lugha mbili: Kiswahili na English (app ya abiria/dereva, makosa ya server, arifa, SMS, masharti) | ✅ |
| 13 | Ukurasa wa kupakua app (APK): link kuu → /pakua/, Android inashauriwa kupakua, iPhone → Add to Home Screen, idadi ya waliopakua ofisini | ✅ sasa |
| 14 | Malipo kwa simu (M-Pesa, Airtel, Mixx/Tigo, HaloPesa) | |
| 15 | Msaidizi wa AI (Claude) unaotumia data halisi | |

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
mobile/                App ya Android (Capacitor): inafungua NAYA ya production + kengele ya maombi (Java)
.github/workflows/     android.yml — GitHub inajenga APK yenyewe
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

### Bei maalum kati ya maeneo (Phase 10.1)

Ofisi → Bei → **Bei maalum kati ya maeneo**: chagua eneo la kuanzia, andika bei kwenda kila eneo (bodaboda na/au bajaji),
bonyeza Hifadhi. Bei ni ile ile kwenda na kurudi. Abiria akitumia GPS ndani ya mita 300 kutoka eneo lililosajiliwa, bei ya
eneo hilo inatumika. Njia isiyo na bei maalum (kisanduku kitupu) inatumia bei za kawaida kwa km. Kwenye app abiria anaona
"bei ya njia hii" badala ya "makadirio". (`naya.route_fares`, `src/services/route-fares.ts`)

## Safari

```
SEARCHING → ACCEPTED → ARRIVED → IN_PROGRESS → COMPLETED
          ↘ NO_DRIVER (hakuna dereva ndani ya dakika 10)
          ↘ CANCELLED (abiria kabla ya safari kuanza, au ofisi)
Dereva akighairi baada ya kukubali → safari inarudi SEARCHING (dereva mwingine anatafutwa).
```

- **Kumpata dereva:** server inaendesha dispatch kila sekunde 3 (`src/server.ts`). Ombi linaenda kwa dereva aliyethibitishwa, aliye online,
  mwenye chombo sahihi, aliye karibu zaidi (ndani ya km 10). Ana **dakika 1** kukubali (app inamkumbusha kwa kengele kila sekunde 20); akikataa, anayefuata anapewa papo hapo. Bila dereva kwa dakika 10 → NO_DRIVER.
- **Usalama wa data:** unique indexes zinazuia dereva au abiria kuwa na safari mbili zinazoendelea; dereva ana ombi moja tu linalosubiri;
  kukubali kunafanyika chini ya row lock (madereva wawili hawawezi kupata safari moja).
- **Nauli** inahesabiwa na server wakati wa kuagiza (haitoki kwenye app). Malipo kwa sasa ni taslimu.
- Kila badiliko la hali linaandikwa kwenye `naya.ride_status_history`.
- Mabadiliko yanafika papo hapo kupitia realtime (tazama chini). Mtandao ukikatika, app inarudi kuangalia kila sekunde 4 mpaka iunganike tena.

- **NAYA karibu nawe:** abiria akifungua app anaona kwenye ramani bodaboda 3 (na bajaji 3) zilizo karibu zaidi zinazoweza kupewa safari
  sasa hivi, na dakika za iliyo karibu kufika (`GET /api/rides/nearby`). Faragha ya dereva: hakuna jina wala namba, mahali
  panazungushwa hadi ~mita 100. Inasasishwa kila sekunde 15.

## Safari rahisi — bila PIN, GPS inasaidia (0.14.2)

Kama Bolt: safari ya kawaida **haina PIN**. Dereva anabonyeza "Abiria amepanda — Anza safari" na mwishoni "Maliza safari".
PIN inabaki kwa **safari za ofa tu** (NAYA inamlipa dereva sehemu ya nauli, kwa hiyo PIN inazuia "safari hewa").
GPS ya dereva (ping ya `/api/driver/location`) inafanya kazi ya kinga ya kusahau:

| Hali | NAYA inafanya nini |
|---|---|
| Dereva yuko ndani ya **m 100** ya abiria | "Nimefika" inawekwa yenyewe (`auto_arrived`) |
| Dereva anabonyeza "Nimefika" akiwa zaidi ya **km 1** | Inakataliwa (409) |
| Baada ya kufika, dereva anaondoka **m 300+** kuelekea unakoenda | Safari inaanza yenyewe (`auto_started`) — si kwa safari za ofa: hapo dereva anakumbushwa PIN mara moja |
| Dereva yuko ndani ya **m 200** ya unakoenda | Ukumbusho "Umefika?"; asipobonyeza, safari inamalizwa yenyewe baada ya **dakika 5** |
| Safari haijamalizwa kwa **saa 3** | Inamalizwa yenyewe, alama `AUTO_TIMEOUT` |
| Abiria anabonyeza "Nimefika — maliza safari" (`POST /api/rides/:id/complete`) | Safari inamalizwa, dereva anajulishwa |

Alama za kutiliwa shaka (`rides.flags`), zinaonekana kwa ofisi kwenye safari, Ripoti → Maombi (na CSV) na Ofa → malipo ya dereva:
`START_FAR` (alianza zaidi ya m 500 kutoka kwa abiria), `ENDED_FAR` (alimaliza zaidi ya m 500 kutoka unakoenda),
`TOO_SHORT` (chini ya dakika 1 kwenye njia ndefu), `AUTO_TIMEOUT`. `completed_by` inaonyesha aliyemaliza:
DRIVER, PASSENGER, AUTO au ADMIN. Migration `021_safari_rahisi.sql` inaongeza safu tu (haifuti data); safari zinazoendelea zisizo
za ofa zinaondolewa PIN ili zisikwame.

## SMS kwenye matukio muhimu (0.26.1)

Matukio haya yalikuwa na arifa ya app tu; sasa yanatuma pia SMS fupi (SMS 1, bila siri yoyote):

- **Akaunti imesimamishwa** (pamoja na sababu na namba ya ofisi — mtu anatolewa kwenye app, kwa hiyo SMS ndiyo njia pekee ya kumjulisha) na **imefunguliwa**.
- **Password imebadilishwa** — "kama si wewe, piga ofisi".
- **Wallet ya dereva:** imesimamishwa / imefunguliwa, marekebisho ya ofisi, **kutoa pesa kumeshindwa** (pesa imerudi kwenye wallet), na **jina la namba ya malipo limebadilika** (mara moja tu kwa kila badiliko).
- **Ada iliyorekodiwa na ofisi kwa mkono** (taslimu) — kama ada iliyolipwa kwa simu.
- **Pesa za mteja:** kurudishiwa kwenye Salio la NAYA, salio kurudishwa kwenye simu, marejesho ya nauli ya mkono.
- **Ofisi imejibu ombi la msaada** — SMS fupi ("fungua app uone jibu"), mara moja tu kila saa 6 kwa mtu mmoja; maandishi ya jibu hayatumwi kwa SMS.
- **Password ya muda** ya dereva aliyesajiliwa na NAYA Staff, ya NAYA Staff mpya, na ya Staff aliyebadilishiwa password — inatumwa pia kwa SMS (bado inaonyeshwa mara moja kwenye skrini).

Matukio ya safari (dereva anakuja, amefika, hakuna dereva…) yanabaki na arifa ya simu tu — ni mengi mno kwa SMS.

## Kituo cha SMS (0.26.0)

Ofisi → Mawasiliano → **Kituo cha SMS** (`#/sms`): kutuma SMS kwa wateja na madereva kwa templates.

- **Wapokeaji:** wateja wote · wateja wapya (wiki hii) · wateja wa zamani (hawajasafiri siku 30) · madereva wote · madereva online · ada inaisha (siku 3 au imeisha) · madereva wanaosubiri uthibitisho · wote · **namba maalum** (andika namba, hata zisizo za NAYA).
- **Templates:** 9 za mwanzo (wateja, madereva, wote), kila moja ni SMS 1. Ofisi inaongeza, inahariri na kuondoa. Maneno yanayojazwa kwa kila mtu: `{jina}` `{jina_kamili}` `{plate}` `{ada_hadi}` `{link}` `{link_pakua}`. Maneno ndani ya `[ ]` (mf. `[andika ofa hapa]`) lazima yabadilishwe kabla ya kutuma.
- **Hakiki kwanza:** idadi ya watu, SMS ngapi (herufi 160 = SMS 1), salio la Beem, na mfano wa SMS tatu zilizojazwa majina. "Tuma" inafanya kazi baada ya hakiki tu, na idadi lazima ilingane (kundi likibadilika katikati, ofisi inaambiwa).
- **Kinga:** watu 2,000 kwa mara moja; ujumbe usizidi SMS 3; salio la Beem lisipotosha → haitumwi; ujumbe uleule kwa watu walewale ndani ya dakika 2 → unazuiwa.
- **Historia:** maendeleo (zimefika Beem / zimeshindwa), kitufe cha **Simamisha**, na orodha ya namba zilizoshindwa pamoja na sababu ya Beem. Server ikianza upya katikati, kutuma kunaandikwa "Imesimamishwa" (hakurudiwi).
- Migration 036: majedwali `sms_templates` na `sms_campaigns`, safu `sms_log.campaign_id` (NULL kwa SMS za zamani) na templates za mwanzo — haifuti data.

## Safari ya mtu mwingine (0.25.0)

Abiria anaweza kumwagizia mtu mwingine safari (mzazi, mtoto, mgeni).

- **Kuagiza:** baada ya kuchagua chombo → "Safari hii ni ya nani?" → **Mtu mwingine** → jina + namba ya anayesafiri → **Mwagizie safari**. "Kutoka" iwe mahali alipo anayesafiri (onyo linaonekana kama ni GPS ya aliyeagiza).
- **Aliyeagiza** ndiye analipa nauli (simu, salio au taslimu ya anayesafiri) na kubeba deni kama nauli haikulipwa. Anaona kadi ya "Safari ya …" yenye kitufe cha kumpigia, link ya kufuatilia na "Mtumie link" (WhatsApp).
- **Dereva** anaona jina la anayesafiri + "Ameagizwa na …", na anampigia **anayesafiri**. Picha na namba ya aliyeagiza hazionyeshwi.
- **Anayesafiri** (bila app wala akaunti): dereva akikubali anapata SMS — jina la dereva, plate, simu na link `/safari/#…`. Link inaonyesha ramani, simu ya dereva, PIN ya ofa, kama nauli imelipwa, na kitufe cha **Dharura** (inafika ofisini kama "Anayesafiri (ameagizwa)"). Safari ikighairiwa, anapata SMS "imeghairiwa".
- SMS zinahitaji funguo za Beem; bila hizo, aliyeagiza anamtumia link kwa WhatsApp. `PUBLIC_URL` (si lazima) = anwani ya link kwenye SMS.
- Ofisi: safari inaonyesha "Aliyeagiza (analipa)" na "Anayesafiri" pamoja na kama SMS ilimfikia.
- Migration 035 inaongeza safu 4 kwenye `naya.rides` (NULL kwa safari za zamani) na kupanua CHECK ya dharura (RIDER) — haifuti data.

## Kurudishia mteja pesa (0.24.0)

Mteja akilalamika (amekatwa mara mbili, safari haikufanyika, huduma mbaya, amezidishiwa nauli, fidia), ofisi inamrudishia pesa yenyewe.

- **Wapi:** Ofisi → Wateja → mteja → paneli **"Pesa za mteja"** (salio, alicholipa, marejesho ya zamani) → **Mrudishie pesa**.
- **Njia mbili:** **Salio la NAYA** — inaingia papo hapo bila ada; au **Namba ya simu** — inatumwa kwa Abliner, ada ya kutuma inabebwa na NAYA, mteja anapokea kiasi kamili.
- Unachagua safari (si lazima), kiasi, sababu na maelezo. Kwa safari moja huwezi kurudisha zaidi ya alicholipa ukitoa alichokwisharudishiwa.
- **Mipaka:** TSh 50,000 kwa refund moja; TSh 200,000 kwa siku kwa simu (yote yanabadilishwa `PUT /api/admin/settings/refunds`).
- **Marejesho kwa abiria** (Fedha → Nauli kwa simu): kitufe "Rudisha kwa simu au salio" kinafungua mteja na safari tayari imechaguliwa; refund ikifanikiwa safari inawekwa DONE.
- Kila refund inaandikwa kwenye kumbukumbu (audit) na mteja anapata arifa + SMS. Malipo ya simu yakishindikana ofisi inaarifiwa.
- Migration 034 inapanua CHECK mbili (`CUSTOMER_REFUND`, `REFUND`) na kuongeza index — haifuti data.

## Salio la NAYA — wallet ya abiria (0.23.0)

Abiria anaweka pesa kwenye **Salio la NAYA** kwa simu (M-Pesa, Mixx, Airtel, HaloPesa) na kulipia safari au deni kwa bonyezo moja — bila ombi la PIN kila safari na bila ada.

- **Kuwasha:** Ofisi → Fedha → Malipo → **Nauli kwa simu** → sehemu ya "Salio la abiria". Imezimwa kwa chaguo-msingi. **Kikomo cha salio ni TSh 15,000** kwa kila abiria (kinabadilika kwenye mipangilio); kiwango cha chini cha kuweka TSh 500.
- **Kuweka pesa:** Akaunti → **Salio la NAYA** → Weka pesa → kiasi (anaona ada ya simu juu, ileile ya nauli kwa simu) → PIN kwenye simu. Salio linaongezeka tu mtandao ukithibitisha.
- **Kulipa:** dereva akishakubali safari (hadi saa 24 baada ya kukamilika) → "Lipa nauli sasa" → **Lipa kwa salio**. Dereva anapata nauli kwenye wallet yake safari ikikamilika. Deni pia linalipwa kwa salio (Deni langu).
- **Safari ikighairiwa** (abiria, ofisi, au hakuna dereva) baada ya kulipa kwa salio → pesa inarudi kwenye salio **papo hapo**.
- **Malipo ya simu yaliyozidi** (mfano simu ilithibitisha baada ya safari kulipwa kwa salio / taslimu) → pesa ya abiria inawekwa kwenye salio lake moja kwa moja.
- **Kurudishiwa salio:** abiria anaomba → ofisi inamtumia kwa Abliner (Send) kisha inaandika **kiasi ilichotuma** + kumbukumbu ("Nimerudisha"). Ombi likiwa wazi, abiria hawezi kuweka pesa wala kulipa kwa salio.
- Salio za abiria zinahesabiwa pamoja na wallet za madereva dhidi ya salio la Abliner (onyo kwenye ofisi likiwa halitoshi).
- **Tahadhari:** kuhifadhi pesa za wateja kunaweza kuhitaji idhini ya Benki Kuu (BoT) — thibitisha kabla ya kuwasha kwa watu wengi.
- Migration 033 inaongeza `naya.customer_wallets` na `naya.customer_wallet_entries` na kupanua CHECK mbili — haifuti data.

## Abiria kulipa nauli kwa simu (0.22.0 · 0.22.1)

Kuanzia **dereva akubali safari** mpaka safari ikamilike, abiria anaona "Lipa nauli kwa simu" kwenye skrini ya safari — analipa wakati wowote anaotaka (au taslimu kwa dereva). Hachagui njia ya malipo wakati wa kuagiza.

- **Malipo ya mapema (0.22.1):** pesa inashikiliwa mpaka safari ikamilike, kisha inaingia kwenye wallet ya dereva aliyemaliza safari. Dereva anaona "Abiria amelipa nauli kwa simu — usimdai".
- **Safari ikighairiwa baada ya kulipa** (abiria, ofisi, au hakuna dereva): abiria anaambiwa "Pesa yako itarudishwa"; ofisi inaona **Marejesho kwa abiria** (Nauli kwa simu) na muhtasari — inamtumia pesa kwa Abliner (Send), kisha inabonyeza "Nimerudisha" na kumbukumbu. Migration 032 inaongeza safu tu.

- **Kuwasha:** Ofisi → Fedha → Malipo → **Nauli kwa simu**. Imezimwa kwa chaguo-msingi. Weka ada juu ya nauli (% na kiwango cha chini) iwe sawa na ada ya Abliner ya kupokea pesa.
- **Abiria:** skrini ya "Umefika" inaonyesha nauli + ada ya simu = jumla. Anaweza kutumia namba yoyote (M-Pesa, Mixx, Airtel, HaloPesa), hadi namba 3 kwa safari moja. Anaweka PIN kwenye simu; "Umelipa" inaonekana tu baada ya mtandao kuthibitisha.
- **Dereva:** anapata **nauli kamili kwenye wallet yake** (ada inabebwa na abiria). Akipewa taslimu anabonyeza "Nimepokea … taslimu". Abiria asipolipa kabisa → "Abiria hajalipa" → deni.
- **Deni:** abiria mwenye deni hawezi kuagiza safari mpya mpaka alipe (Akaunti → Deni langu, kwa simu); pesa inaenda kwenye wallet ya dereva aliyemdai. Ofisi inaweza kuondoa deni ("amemlipa dereva taslimu" au "samehe") kwa sababu.
- **Usalama:** malipo yanakubaliwa mara moja tu kwa kila safari. Malipo yakithibitishwa baada ya dereva kuandika taslimu, wallet haiguswi tena na ofisi inajulishwa. Dereva haoni namba alizotumia mlipaji.
- Malipo yote yanaonekana kwenye Miamala ya simu (kichujio "Nauli kwa simu"). Migration 031 inaongeza safu tu kwenye `naya.rides` na kupanua CHECK moja — haifuti data.

## Wallet ya dereva (0.21.0)

Kila dereva aliyethibitishwa ana wallet yake ndani ya NAYA (inafunguliwa yenyewe). Pesa halisi iko kwenye akaunti ya NAYA kwa Abliner; wallet ni deni la NAYA kwa dereva, linalorekodiwa mstari kwa mstari (ledger).

- **Mapato yanaingia wallet:** malipo ya ofa yanaingia kwenye wallet badala ya kutumwa kila safari (Ofisi → Malipo → Wallet za madereva → Mipangilio; ukiondoa alama, malipo yanatumwa moja kwa moja kama zamani).
- **Kutoa pesa:** dereva anachagua kiasi → anaona ada ya mtandao na atakachopokea (kutoka Abliner) → anaweka PIN → pesa inatumwa **kwenye namba yake kuu iliyothibitishwa tu** (jina la mtandao). Kiwango cha chini TSh 1,000, kikomo TSh 100,000 kwa siku (vinabadilika kwenye mipangilio). Ada ya mtandao inabebwa na dereva.
- **PIN ya wallet (tarakimu 4):** dereva anaitengeneza mwenyewe kwa password ya akaunti; ofisi haiioni (inahifadhiwa kama hash). PIN rahisi (1234, 0000, tarakimu za mwisho za simu) zinakataliwa. Makosa 5 → imefungwa dakika 30; makosa 10 → imefungwa mpaka ofisi ifungue.
- **Nimesahau PIN:** dereva anaomba → ofisi inampigia kuthibitisha → "Ruhusu PIN mpya" → dereva anaweka PIN mpya kwa password yake → kutoa kunasubiri saa 24.
- **Namba ya malipo:** kubadilisha au kufuta namba kuu kunahitaji PIN na kunaanzisha saa 24 za usalama (dereva anapata SMS).
- **Ada ya mwezi kwa salio:** "Lipa ada" kwenye wallet (PIN). Ofisi ikibatilisha malipo hayo, pesa inarudi kwenye wallet.
- **Kutoa kukishindwa:** pesa yote inarudi kwenye wallet mara moja; tatizo la mtandao → inabaki "inasubiri" na mfumo unakagua hali (hautumi mara mbili).
- **Ofisi:** Fedha → Malipo → **Wallet za madereva** — deni la wallet zote dhidi ya salio la Abliner (onyo likiwa halitoshi), maombi ya PIN, orodha, na kwa kila dereva: historia kamili, kusimamisha/kufungua, kufungua PIN, kuruhusu PIN mpya, marekebisho (kiasi + sababu, yanaonekana kwa dereva).
- Muhtasari wa ofisi unaonyesha "Salio la Abliner halitoshi wallet za madereva" na "Madereva wameomba PIN mpya ya wallet".
- Hakuna commission. Migration 030 inaongeza `naya.wallets` na `naya.wallet_entries` tu — haifuti wala kubadilisha data iliyopo.

## Jina la mwenye namba na Control Number (0.20.0)

Kutoka nyaraka za Abliner (hakuna endpoint iliyobuniwa): `GET /api/v1/lookup?phone=` → `{ phone, name, network }`
(404 `name_not_found` = haijathibitishwa) na `POST /api/v1/control-numbers` `{ amount, description, payment_mode, reference, customer_name? }`
→ `{ id, control_number, … }`; ikilipwa, webhook ileile ya deposits (`transaction.completed`) inakuja. **Hakuna cha kubadilisha
Railway wala Abliner.** Migration `029_majina_na_control.sql` inaongeza `phone_names` (cache), `name_lookups` (kumbukumbu),
safu za uthibitisho kwenye `driver_payout_accounts`, na njia `CONTROL` kwenye kumbukumbu za ada (haifuti data).

- **Namba tu → jina linatokea**: namba za malipo za dereva (anathibitisha "jina hili ni sahihi"; jina la mtandao ndilo linahifadhiwa),
  Ofisi → Ongeza staff, NAYA Staff → Sajili bodaboda. Huduma isipopatikana, jina linaandikwa kwa mkono kama zamani.
- **Faragha**: `POST /api/name-lookup` ni kwa dereva, NAYA Staff na ofisi tu; kikomo cha namba tofauti kwa saa 24
  (dereva 15, staff 80, ofisi 300); kila ombi linaandikwa. Namba haiandikwi kwenye logs.
- **Kinga ya malipo**: kabla ya kumtumia dereva pesa, jina la namba linaangaliwa tena (cache ≤ saa 6). Likiwa la mtu mwingine
  (laini imehamishwa) au mtandao haulijui → pesa haitumwi, safari inaonyesha sababu, dereva anapata arifa. Akithibitisha namba
  upya kwenye app, malipo yaliyosimama yanatumwa yenyewe. Huduma ya majina ikiwa chini → malipo yanaendelea.
- **Control number ya ada**: Akaunti → Ada ya mwezi → "Pata control number" (kiasi kamili, `EXACT`; siku 7). Dereva analipa
  kutoka M-Pesa, Mixx, Airtel Money, HaloPesa au benki; siku zinaongezwa zenyewe. Namba ileile kwa miezi ileile; zisizozidi 3
  zisizolipwa. Ikilipwa baada ya kuisha muda bado inakubaliwa.

## Ruhusa ya NAYA Staff kwa akaunti iliyopo (0.19.1)

Namba moja = akaunti moja. Ofisi ikiandika namba ambayo tayari ina akaunti (abiria au dereva), haipati kosa tena:
inaonyeshwa jina na aina ya akaunti → **"Ndiyo, mpe ruhusa ya staff"**. Migration `028_staff_ruhusa.sql` inaongeza
`users.staff_access` (NULL / ACTIVE / SUSPENDED), `staff_since`, `staff_added_by` (haifuti data).

- Hakuna akaunti mpya wala password mpya — anaingia kwa password yake ile ile. "Password mpya" ya ofisi haipo kwa akaunti hizi.
- Kwenye app: **Akaunti → Badili mode → "Fungua NAYA Staff"** (inaonekana kwa wenye ruhusa tu; `#/s`). Dereva aliye online
  anaulizwa na kuwekwa offline kwanza. "Rudi kwenye Dereva/Abiria" inamrudisha kwenye app yake.
- Kusimamisha kunaondoa **ruhusa ya staff tu**: udereva, safari, salio na malipo yake vinaendelea; token yake haifi.
- Hawezi kujisajili mwenyewe kama dereva (namba iliyopo inakataliwa) wala kuthibitisha madereva. Akaunti za ofisi haziwezi kuwa staff.
- API mpya: `POST /api/admin/staff/lookup` · `POST /api/admin/staff` inakubali `linkExisting: true`. `/api/account` ina `staffAccess`.

## NAYA Staff (0.19.0)

Wasaidizi wa NAYA wanaoingia kwenye **app ya NAYA** (si ofisi) na kupata kazi zao tu. Migration `027_naya_staff.sql` inaongeza
cheo `STAFF`, `users.must_change_password`, `users.created_by`, `drivers.registered_by` na hali ya ukaguzi ya maeneo (haifuti data).

- **Ofisi → Mipangilio → NAYA Staff** (`#/staff`): ongeza staff (jina + simu) → password ya muda inaonyeshwa mara moja;
  simamisha / rudisha / password mpya; idadi ya kazi ya kila staff.
- **Staff kwenye app**: anaweka password yake kwanza, kisha: *Sajili bodaboda* (akaunti + chombo + picha 4 kwa kamera → "Inasubiri ofisi"),
  *Ongeza eneo* (GPS ya simu → linasubiri ofisi), *Kazi zangu*. Haoni pesa, mipangilio, wateja wala safari; hawezi kuingia `/admin`.
- **Ofisi pekee inathibitisha madereva.** Dereva aliyesajiliwa na staff: "Amesajiliwa na NAYA Staff: …" kwenye ofisi; akiingia kwenye app
  kwa password ya muda anaibadilisha na kukubali Masharti ya Dereva mwenyewe.
- **Maeneo ya staff** hayaonekani kwa wateja mpaka ofisi iyaidhinishe (Maeneo → "Maeneo yanayosubiri uidhinishe"; pia kwenye Muhtasari).
- API: `/api/staff/*` (STAFF tu, baada ya kubadilisha password), `/api/admin/staff*`, `/api/admin/locations/pending`, `/api/admin/locations/:id/review`.

## Malipo ya ofa: ada na kiasi kidogo (0.18.2)

- **NAYA inabeba ada ya kutuma** — dereva anapokea deni lake kamili. Kabla ya kila withdrawal NAYA inauliza Abliner
  `GET /api/v1/withdrawals/preview` na (kwa chaguo-msingi "inakatwa kwa dereva") inaongeza ada kwenye kiasi cha kutuma.
  Mipangilio ya mfumo → Malipo ya simu → "Ada ya Abliner ya kutuma" inaweza kubadilishwa kuwa "kwenye salio la NAYA".
  Ada iliyolipwa inaonekana kwenye Miamala ya simu (`payments.meta.fee`, `meta.sendAmount`); `payments.amount` ni deni la dereva.
- **Kima cha chini cha kutuma** (chaguo-msingi TSh 1,000): deni dogo zaidi halitumwi peke yake — safari inakuwa `WAITING`
  ("Inakusanywa") na inatumwa pamoja na safari zijazo za ofa za dereva huyo kwa muamala mmoja. Migration `026_malipo_madogo.sql`
  inapanua CHECK ya hali tu.
- Kiasi cha webhook kinakaguliwa kwa pesa inayoingia tu (Abliner inaweza kuripoti kiasi baada ya ada kwa pesa inayotoka).

## Ofisi — mpangilio mpya (0.18.0)

Menyu ya pembeni kwa makundi (inaweza kukunjwa kuwa alama tu; inakumbukwa kwenye browser):

| Kundi | Kurasa |
|---|---|
| — | Muhtasari, Ripoti |
| Operesheni | Ramani live, Safari, Dharura |
| Watu | Madereva, Wateja |
| Fedha | **Malipo** (`#/malipo`: salio la Abliner, malipo yanayosubiri uamuzi, madeni ya ofa, miamala), Ada ya mwezi, Ofa |
| Mawasiliano | Msaada, Maoni, Matangazo |
| Mipangilio | **Mipangilio ya mfumo** (`#/mipangilio`: mfumo huru, malipo ya simu, ada), Bei na nauli, Maeneo |

- Muhtasari una kadi ya **salio la akaunti kuu ya Abliner** (`GET /api/admin/payments/wallet` — server inaliuliza Abliner mara moja kila
  sekunde 30): pesa zilizoingia/kutoka leo, zinazosubiri uthibitisho. Salio likishuka chini ya kiwango (`PUT /api/admin/payments/wallet-settings`,
  chaguo-msingi TSh 1,000) → kadi nyekundu + "Kazi zinazokusubiri".
- Anwani za zamani `#/ofa/malipo…` na `#/ofa/miamala` zinapelekwa `#/malipo/madereva…` na `#/malipo/miamala`.
- Mwendo (animations) unaheshimu "reduce motion" ya kifaa.

## Abliner — malipo halisi ya simu (0.17.0)

Imejengwa kwa nyaraka za https://abliner.net/docs tu (hakuna endpoint iliyobuniwa):

| Kazi | Abliner |
|---|---|
| Ada ya mwezi (dereva → NAYA, USSD push) | `POST /api/v1/deposits` `{amount, method:"mobile", currency:"TZS", phone, reference, callback_url}` + `Idempotency-Key` + `x-abliner-timestamp` / `x-abliner-signature` (hex HMAC-SHA256 ya `ts.body`, `ABLINER_WEBHOOK_SECRET`) |
| Malipo ya ofa (NAYA → bodaboda) | `POST /api/v1/withdrawals` `{amount, method:"mobile", currency:"TZS", recipient, reference}` |
| Hali ya muamala (callback ikichelewa) | `GET /api/v1/transactions?customer_reference=<reference yetu>` |
| "Kagua muunganiko" (ofisi) | `GET /api/v1/balance` — haigusi pesa |
| Webhook | `POST /api/payments/callback/abliner` — `x-webhook-signature` (hex HMAC-SHA256 ya `x-webhook-timestamp.rawBody`), timestamp ≤ sekunde 300, `x-webhook-id` inazuia marudio |

Usalama wa pesa:

- Hakuna kinachoandikwa "kimelipwa" bila webhook iliyothibitishwa au `/transactions` kusema `completed`; hali nyingine yoyote = inasubiri.
- Kiasi cha webhook kikipingana na chetu → hakitumiki (ofisi inajulishwa).
- Withdrawals hazina idempotency iliyoandikwa na Abliner → NAYA **hairudii kutuma yenyewe**. Jibu likipotea, muamala unabaki
  "haujathibitishwa" mpaka Abliner iseme `completed`/`failed`; ofisi inaweza "Jaribu tena" baada ya `failed` tu.
- Kikomo cha malipo ya simu kwa dereva: TSh 10,000 kwa siku (Africa/Dar_es_Salaam) — kwa malipo ya moja kwa moja NA "Tuma" ya ofisi,
  ndani ya transaction yenye lock ya dereva.
- Migration `025_abliner.sql` inaongeza jedwali `payment_webhook_events` tu.

Kuwasha (Railway → Variables): `ABLINER_API_KEY`, `ABLINER_WEBHOOK_SECRET`, kisha `PAYMENT_PROVIDER=abliner`.
Webhook URL ya kuweka Abliner → Dashboard → API Keys: `https://naya-production-e5cf.up.railway.app/api/payments/callback/abliner`
(NAYA pia inaituma kama `callback_url` kwenye kila deposit, kupitia `RAILWAY_PUBLIC_DOMAIN`).

## Mfumo huru — madereva wachache (0.16.2)

Migration `024_mfumo_huru.sql` inaongeza mpangilio `settings.dispatch = {"openMode": true}` (haifuti data). Ukiwa umewashwa:

- ada ya mwezi haitozwi: dereva anaenda online na kupewa safari hata ada/siku za bure zimeisha (app haimzuii; ukumbusho na
  arifa za "ada imeisha" hazitumwi);
- mfumo haumweki dereva offline (kukosa kujibu, simu kutoonekana, ada) — anaenda offline mwenyewe tu;
- simu "iliyolala" (app imefungwa) bado inapewa maombi;
- ombi linaenda kwa madereva WOTE wa chombo hicho walio ndani ya km 10 kwa pamoja (hadi 10), sekunde 20; wa kwanza kukubali anapata safari.

Vinavyobaki: kuidhinishwa na ofisi, akaunti hai, namba ya simu iliyothibitishwa, chombo sahihi, GPS, km 10, kutokuwa kwenye safari.
Ofisi → **Ada ya mwezi** → "Mfumo huru" → Zima, sheria za kawaida (hapa chini) zinarudi. API: `GET/PUT /api/admin/settings/dispatch`.

## Kumpata dereva haraka (0.16.1) — sheria za kawaida (mfumo huru ukizimwa)

| Kipengele | Thamani |
|---|---|
| Wimbi la 1 | madereva 2 walio karibu zaidi kwa pamoja, sekunde 15 |
| Wimbi la 2+ | madereva 4 wanaofuata kwa pamoja, sekunde 20 |
| Mpangilio | simu zilizoonekana hivi karibuni kwanza, kisha aliye karibu |
| Dereva wa app (APK) | anapewa maombi hadi dakika 10 tangu simu ilipoonekana mara ya mwisho |
| Online bila kuonekana | simu isipoonekana dakika 20 (na hana safari) → offline + arifa |
| Ombi la ofisi | sekunde 30 |

Dereva ambaye ombi lake liliondolewa kwa sababu mwingine aliwahi (TAKEN) anapewa tena safari ile ikirudi kutafuta dereva.
Ofisi → safari inayotafuta dereva → **Mpe dereva maalum**: madereva WOTE walio online, kila mmoja na sababu kama hapewi maombi
(chombo tofauti, ada imeisha, hajaidhinishwa, hana GPS, yuko kwenye safari, anajibu ombi jingine, simu haijaonekana, yuko mbali).
Hakuna migration.

## Malipo ya simu (0.16.0)

Pesa ya simu (M-Pesa, Mixx by Yas, Airtel Money, HaloPesa) kupitia kampuni ya malipo (`PAYMENT_PROVIDER`).
Bila `PAYMENT_PROVIDER` kila kitu kinabaki cha mkono kama zamani.

**1. Ada ya mwezi** — Akaunti → Ada ya mwezi → "Lipa kwa simu sasa" (miezi 1–3, mtandao unachaguliwa kutoka namba).
`POST /api/driver/subscription/pay` → ombi la PIN (USSD push) → app inasubiri (`GET /api/payments/:id`) → kampuni ikithibitisha
(callback `POST /api/payments/callback/:provider` au swali la hali kila dakika) → siku zinaongezwa zenyewe, risiti + SMS.
Ombi lisilojibiwa dakika 15 → "limeshindwa"; uthibitisho ukifika baadaye bado unaongeza siku.

**2. Malipo ya ofa ya papo hapo** — safari ya ofa ikikamilika, NAYA inatuma sehemu ya dereva kwenye namba yake kuu
(M-Pesa / Mixx / Airtel / HaloPesa) yenyewe, kama: hakuna alama ya kutiliwa shaka, haikumalizwa na ofisi, na jumla ya leo ≤ kikomo
(chaguo-msingi TSh 10,000 kwa dereva kwa siku; ofisi inabadilisha). Vinginevyo → **inasubiri ukaguzi** (Ofisi → Ofa → Malipo kwa madereva):
"Tuma" au "Kataa" (iliyokataliwa haidaiwi tena). Kutuma kukishindwa → "Jaribu tena". Hali ya safari: `rides.promo_payout_state`.

**Kinga:** muamala unaandikwa "Imefaulu" tu kampuni ya malipo ikithibitisha; callback mara mbili haiongezi mara mbili (row lock +
unique `payment_id`); malipo ya kutoka hayaandikwi "yameshindwa" kwa kukosa jibu (yanaonekana "Hayajathibitishwa" ofisini);
kiasi hakizidi deni la NAYA kwa dereva. Ofisi inaweza kuzima malipo ya papo hapo wakati wowote. Miamala yote: Ofisi → Ofa → Miamala ya simu (+ CSV).

**Kuunganisha kampuni ya malipo:** adapter moja inayotimiza `PaymentProvider` (`src/services/payments/provider.ts`) —
`collect`, `disburse`, `status`, `parseCallback` (lazima ithibitishe saini) — na kuisajili kwenye `getProvider()`.
Kampuni bandia ya majaribio: `src/services/payments/simulator.ts` (haiwezi kuwashwa production).
Migration `023_malipo.sql` inaongeza jedwali na safu tu.

## Akaunti mpya (0.15.0)

App → **Akaunti** sasa ni menyu (kama Bolt/Uber), si orodha ndefu ya kadi:

| Sehemu | Njia | Kina nini |
|---|---|---|
| Wasifu | `#/akaunti/wasifu` | Picha (mraba 640px JPEG, inapunguzwa kwenye simu), jina, simu, takwimu (safari, nyota, alichookoa kwa ofa) |
| Ofa | `#/akaunti/ofa` | Ofa zinazomfaa, alichookoa, jinsi ofa zinavyofanya kazi (haionekani kwenye mode ya Dereva) |
| Shughuli | `#/akaunti/shughuli` | Safari zake (na za udereva kama ni dereva) + arifa |
| Usalama | `#/akaunti/usalama` | Mtu wa dharura, vipengele vya usalama safarini, namba 112 na Msaada wa NAYA |
| Msaada | `#/akaunti/msaada` | Simu / WhatsApp +255 628 986 770, barua pepe, ripoti tatizo (`#/akaunti/msaada/mpya`), maswali ya haraka, toa maoni |
| Mipangilio | `#/akaunti/mipangilio` | Lugha, arifa, sauti, password, APK, masharti |
| Udereva | `#/akaunti/ada`, `#/akaunti/malipo-ya-ofa` | Kwa madereva walioidhinishwa tu |

- **Picha ya mteja inaenda kwa dereva:** dereva aliyepewa ombi anaona jina la kwanza, picha na nyota za abiria
  (`offer.passenger`), na wakati wa safari (`ride.passenger.hasPhoto`). Picha: `GET /api/driver/rides/:id/passenger-photo` —
  dereva wa safari au aliye na ombi linalosubiri tu; wengine 404. Namba ya simu ya abiria bado inaonekana baada ya kukubali tu.
- API: `GET/PUT /api/account/profile`, `PUT /api/account/photo` (body = picha), `POST /api/account/photo/delete`,
  `GET /api/account/photo`, `PUT /api/account/emergency`, `POST /api/account/emergency/delete`, `GET /api/admin/users/:id/photo`.
- Dereva anayehakikiwa / aliyeidhinishwa hawezi kubadilisha jina mwenyewe (limethibitishwa na nyaraka).
- **Mtu wa dharura** anaonekana kwenye "Dharura" safarini (kitufe cha kumpigia), kwa ofisi kwenye Dharura na kwenye wasifu wa mtumiaji.
- Mawasiliano ya Msaada yako kwenye `frontend/shared/contact.js`.
- Migration `022_akaunti.sql` inaongeza safu tu (`photo_file_id`, `photo_updated_at`, `emergency_name`, `emergency_phone`).

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
- **PIN ya safari (safari za ofa tu tangu 0.14.2):** safari ya ofa ina PIN ya tarakimu 4 inayoonekana kwa abiria tu. Dereva anaiingiza kuanza safari. Ikikosewa mara 5,
  safari haiwezi kuanzishwa (ofisi inaona kwenye ukurasa wa safari).
- **Shiriki safari:** abiria anatuma link (`/safari/#…`) kwa ndugu; inaonyesha dereva, plate na ramani bila kuingia, bila namba za simu,
  na inakufa saa 2 baada ya safari kuisha. Database inahifadhi SHA-256 ya link tu.
- **Dharura (SOS):** abiria au dereva anabonyeza *Dharura* → ofisi inaona bango jekundu na kengele papo hapo (Ofisi → Dharura),
  pamoja na namba za simu za wote wawili na mahali. App pia ina kitufe cha kupiga Polisi (112).

## SMS kupitia Beem (Phase 9)

1. Fungua akaunti ya [Beem](https://beem.africa), nunua SMS, na omba **Sender ID** (mf. `NAYA`). Mpaka iidhinishwe, tumia `INFO`.
2. Beem → Profile → *Authentication Information*: nakili **API Key** na **Secret Key**.
3. Weka kwenye `.env` NA Railway → Variables: `BEEM_API_KEY`, `BEEM_SECRET_KEY`, `BEEM_SENDER_ID`.

SMS zikiwa zimewashwa:
- **Mtumiaji mpya** anapokea SMS yenye namba ya tarakimu 6 na kuithibitisha kabla ya kuendelea. Bila namba iliyothibitishwa,
  hawezi kuagiza safari, kwenda online, wala kutuma ombi la udereva. Watumiaji waliojisajili kabla ya Phase 9 hawaombwi kuthibitisha.
- **Umesahau password?** (skrini ya kuingia): namba ya simu → SMS → namba + password mpya. Vifaa vyote vilivyoingia vinatolewa.
  Jibu ni lile lile kama namba imesajiliwa au la (mtu asijue namba zipi ziko NAYA).
- **Usalama wa namba za SMS:** zinadumu dakika 10, majaribio 5, sekunde 60 kati ya SMS mbili na SMS 5 kwa saa kwa namba moja.
  Database inahifadhi HMAC ya namba tu; kumbukumbu ya SMS (`naya.sms_log`) ina aina na matokeo tu, si maandishi.
- **SMS za taarifa muhimu** (zinalipiwa, kwa hiyo chache tu): dereva amethibitishwa, ombi la udereva linahitaji marekebisho,
  ada inakaribia kuisha, ada imeisha.
- Ofisi → Muhtasari → **SMS**: salio la Beem, SMS za leo na mwezi huu, na zilizoshindwa.
- **SMS ya majaribio (0.25.1):** Ofisi → Muhtasari → SMS → andika namba yako → **Tuma**. Ikishindwa, ofisi inaona jibu la Beem (funguo, Sender ID au salio).
- **Kuwasha mara ya kwanza (0.25.1):** server ikiwaka na funguo za Beem kwa mara ya kwanza, watumiaji WALIOPO (waliojisajili SMS zikiwa zimezimwa) wanahesabiwa wamethibitishwa — madereva na wateja wa sasa hawazuiwi ghafla. Wapya wanathibitisha kwa SMS. Inafanyika mara moja tu (`settings.sms_activation`) na inaandikwa kwenye kumbukumbu.

Bila funguo za Beem, SMS zimezimwa: hakuna anayeombwa kuthibitisha namba, na "Umesahau password?" inamwambia mtu awasiliane na ofisi.

## Muonekano (Phase 9.5)

- **Kufungua app:** logo inang'aa, inazunguka na chembe za dhahabu na kijani, kisha jina NAYA linajichora (`frontend/app/splash.js`
  + CSS). Mara ya kwanza kwenye kikao ni sekunde ~3; refresh baadaye ni fupi. Mode ya mwisho ikiwa Dereva, logo ni ya njano.
- **Sauti ya logo:** `frontend/shared/sounds/naya-intro.mp3` (sek 3.4) inalingana na animation: mvumo logo ikizunguka, "pop" ya kitone
  cha dhahabu, noti 4 herufi N-A-Y-A zikijichora, na mng'ao mwishoni. Browsers huzuia sauti kabla mtu hajagusa skrini, kwa hiyo
  inasikika kwa uhakika app ikiwa imesakinishwa (Add to Home Screen / APK) au mtu akigusa skrini wakati logo inajitengeneza.
  Mtumiaji anaweza kuizima: Akaunti → Sauti ya kufungua NAYA.
- **Utangulizi:** slaidi 3 za kuteleza kwa kidole, mara ya kwanza tu (`frontend/app/intro.js`).
- **Logo:** `naya-icon-light.svg` (nyeupe) juu ya kijani — app ya abiria; `naya-dereva-icon.svg` (njano) — mode ya Dereva;
  `naya-icon.svg` (kijani) — favicon na ofisi.
- **Herufi** (Bricolage Grotesque, Atkinson Hyperlegible) zinatolewa na server yenyewe (`frontend/shared/fonts/`, leseni OFL) —
  hakuna Google Fonts; zinapakia haraka kwenye mitandao ya simu.
- Picha ya bodaboda na bajaji: `frontend/shared/img/naya-hero.webp`.
- Simu zote: imejaribiwa upana 320px hadi kompyuta; heshima kwa "punguza mwendo" (reduced motion) ya simu.

## App ya Android — APK (Phase 10)

App ya Android ni "ganda" jembamba (Capacitor) linalofungua `https://naya-production-e5cf.up.railway.app/app/`. Kwa hiyo kila
mabadiliko ya NAYA yanayopushiwa Railway yanaonekana kwenye app papo hapo — **APK inahitaji kujengwa upya tu sehemu ya simu
(`mobile/`) ikibadilika.** Kitu ambacho browser haiwezi, app inakiweza:

- **Kengele ya ombi la safari:** ombi likimfikia dereva, simu inalia kama simu inayoingia — sauti ya NAYA inajirudia mpaka
  **sekunde 30** (au mpaka ombi liishe), hata app ikiwa imefungwa, dereva yuko WhatsApp, au skrini imezimwa. Kwenye skrini iliyofungwa
  NAYA inajitokeza juu yake. Kengele inasimama dereva akigusa arifa/app, akibonyeza "Zima kengele", au ombi likichukuliwa,
  likighairiwa au likiisha muda (server inatuma `offer_cancel`).
- Taarifa nyingine (dereva amepatikana, ada, nk.) zinakuja kama arifa za kawaida.
- Akaunti → Arifa: "Washa arifa", "Jaribu kengele", na ruhusa ya kuonyesha ombi juu ya skrini iliyofungwa (Android 14+).
- Server inatuma kupitia Firebase Cloud Messaging (HTTP v1, `src/services/fcm.ts`); simu zinasajiliwa kwenye `naya.fcm_tokens`
  (`POST /api/push/fcm`). Mtumiaji akitoka, simu zake zote zinafutwa. Ofisi → Hali ya mfumo inaonyesha madereva wenye kengele.

### Kuwasha (mara moja tu, kwa kubofya — hakuna code)

1. **Firebase:** [console.firebase.google.com](https://console.firebase.google.com) → Add project → "NAYA" (Analytics si lazima).
   Ndani ya project: Add app → **Android** → Package name: `tz.naya.app` → Register → **Download google-services.json**.
2. **GitHub:** repo ya NAYA → Settings → Secrets and variables → Actions → New repository secret →
   Name: `GOOGLE_SERVICES_JSON`, Secret: fungua google-services.json kwa Notepad, nakili maandishi YOTE na ubandike.
3. **Railway:** Firebase → ⚙ Project settings → Service accounts → **Generate new private key** (faili la JSON).
   Railway → NAYA → Variables → `FIREBASE_SERVICE_ACCOUNT` = maandishi yote ya faili hilo. (Ni siri — usiliweke GitHub.)
4. Push code. GitHub → **Actions** → "NAYA Android (APK)" inajenga (dakika 5–10). Ikimaliza: GitHub → **Releases** → `NAYA.apk`.
   Kwa mkono wakati wowote: Actions → NAYA Android (APK) → Run workflow.
5. (Si lazima) Railway → Variables → `ANDROID_APK_URL` = `https://github.com/theodickson70-star/NAYA/releases/latest/download/NAYA.apk`
   — madereva wanaotumia Chrome wataona "Pakua app (APK)" kwenye Akaunti. Link hii inafanya kazi tu repo ikiwa **public**;
   repo ikiwa private, pakua APK wewe mwenyewe na uwatumie madereva (WhatsApp/Bluetooth).

### Kwenye simu ya dereva

- Fungua `NAYA.apk` → ruhusu "Install unknown apps" → Install. Ingia, Akaunti → **Washa arifa** → **Jaribu kengele**.
- Android 14+: bonyeza **Ruhusu** ili ombi lijitokeze juu ya skrini iliyofungwa.
- Simu za Tecno, Infinix, itel, Xiaomi, Oppo huzima apps zilizo nyuma ili kuokoa betri: Settings → Apps → NAYA → Battery →
  **No restrictions / Usizuie**, na washa **Autostart** kama ipo. Bila hivyo kengele inaweza kuchelewa.
- Bila `GOOGLE_SERVICES_JSON` APK bado inafanya kazi (kama app ya kawaida), lakini bila kengele app ikiwa imefungwa.

### Play Store (baadaye)

- Akaunti ya Google Play Console ni malipo ya mara moja (~USD 25).
- Tengeneza keystore ya NAYA mara moja na uiweke kama secrets `NAYA_KEYSTORE_BASE64`, `NAYA_KEYSTORE_PASSWORD`, `NAYA_KEY_ALIAS`,
  `NAYA_KEY_PASSWORD` — workflow itajenga APK iliyosainiwa na `NAYA-playstore.aab`. **Usipoteze keystore**: bila hiyo huwezi
  kutoa update ya app hiyo hiyo Play Store.
- Sera ya Google: ruhusa ya "full-screen" (`USE_FULL_SCREEN_INTENT`) inaruhusiwa moja kwa moja kwa apps za simu/kengele tu;
  kwa NAYA Google inaweza kuomba maelezo au kuizima — kengele ya sekunde 30 bado inalia, ila haitajitokeza juu ya skrini iliyofungwa.
- Bila keystore, APK ni ya "debug" (inafaa kwa kusambaza moja kwa moja). GitHub inahifadhi ufunguo wake ili update isakinike juu
  ya ya zamani; ikitokea simu ikakataa ("App not installed"), futa NAYA ya zamani kisha usakinishe mpya.

## Maoni kwa wote (0.14.1)

- **Kichupo cha "Maoni"** kwenye menyu ya chini (Nyumbani · Maoni · Akaunti) kwa abiria na madereva: nyota, mada, maoni, na orodha ya maoni uliyotuma pamoja na **jibu la ofisi**. Jibu jipya → kitone kwenye kichupo, kinaondoka ukishasoma.
- **Baada ya safari:** chini ya nyota, "Una maoni kuhusu NAYA?" → maoni yanaambatana na safari hiyo.
- **Safari ikikwama** (hakuna dereva / imeghairiwa na dereva au ofisi): kitufe **"Tuambie kilichotokea"** chenye mifano ya haraka; ukishatuma, skrini ya safari hiyo inafungwa.
- Ofisi → Maoni inaonyesha safari iliyoambatanishwa ("Safari ilikwama" / "Baada ya safari") na link ya safari.
- Dereva akiwa kwenye Maoni au Akaunti ombi jipya likiingia, app inamrudisha Nyumbani asilikose.
- Migration `020_maoni_wazi.sql`: `feedback.ride_id`, `source`, `reply_seen_at` na mada mpya "Safari hii" — hakuna data inayofutwa.

## Ofa za wateja na malipo ya NAYA kwa madereva (0.14.0)

Ofisi → **Ofa**:
- **Kuunda ofa:** wateja wote au wateja wapya (hawajawahi kusafiri), asilimia ya punguzo, punguzo la juu kwa safari, nauli ya chini/juu, vyombo, safari kwa kila mteja, safari kwa kila dereva (kwa siku / wiki / kipindi chote), bajeti ya NAYA, tarehe ya kuanza na kuisha, kipaumbele. Fomu inaonyesha mfano wa bei (safari ya 2,000 / 3,000 / 5,000) unapoandika.
- **Kuwasha / kusimamisha / kumaliza** ofa. Ofa mpya inaanza ikiwa imesimamishwa.
- **Takwimu kwa kila ofa:** safari, wateja, madereva, gharama ya NAYA, walicholipa wateja, bajeti iliyobaki, na orodha ya safari zake.
- Ofa mbili za sasa zimeandaliwa (zimesimamishwa — bonyeza **Washa ofa**):
  1. *Nusu bei kwa wateja wote* — 50%, kila dereva safari 3 za ofa kwa wiki.
  2. *Mteja mpya: safari 2 nusu bei* — 50%, punguzo hadi TSh 1,500, safari 2 kwa mteja.

Kanuni:
- Safari moja = ofa moja tu, yenye punguzo kubwa zaidi kwa mteja (zikilingana, kipaumbele kikubwa zaidi). Punguzo linahesabiwa na server, linazungushwa chini kwa TSh 50.
- Mteja analipa dereva (nauli − punguzo) taslimu; NAYA inamdai dereva punguzo safari ikikamilika.
- Kikomo cha dereva: ombi la safari ya ofa linaenda kwa madereva walio na nafasi tu. Kama hakuna dereva mwenye nafasi karibu, safari inaendelea kwa nauli kamili na mteja anaambiwa wazi (anaweza kughairi bure).
- Safari iliyoghairiwa au iliyokosa dereva inarudisha nafasi ya mteja na bajeti.
- Mtumiaji aliye dereva (au anayeomba kuwa dereva) hapati ofa.

Malipo kwa madereva (Ofisi → Ofa → **Malipo kwa madereva**):
- Dereva anaweka namba zake za kupokea pesa kwenye app (Akaunti → **Malipo ya ofa**): M-Pesa, Mixx by Yas (Tigo Pesa), Airtel Money, HaloPesa, T-Pesa au benki; hadi namba 3, moja kuu.
- Ofisi inaona kila dereva: safari za ofa, NAYA inadaiwa kiasi gani, kimelipwa kiasi gani, salio, na **namba ya kutuma pesa**. Pakua Excel (CSV).
- Ofisi inatuma pesa kwanza, kisha **inaandika malipo** pamoja na namba ya muamala (kiasi hakizidi deni; muamala mmoja hautumiki mara mbili). Dereva anapata arifa + SMS. Malipo yaliyokosewa yanafutwa kwa sababu.
- Migration `019_ofa.sql`: tables `promotions`, `driver_payout_accounts`, `promo_payouts` na columns za ofa kwenye `rides` — hakuna data inayofutwa.


### Uwazi wa ofa (0.14.3)

- **Chunguza mteja** (Ofisi → Ofa → Chunguza mteja, `GET /api/admin/promotions/check?phone=&fare=&vehicle=`): namba ya simu →
  "Anaona ofa" au "Haoni ofa" na sababu moja wazi (ni dereva, si mteja mpya, ameshatumia safari zake, nauli nje ya kiwango,
  chombo kingine, ofa imesimamishwa / haijaanza / imeisha, bajeti imeisha), kila ofa na sababu yake, na safari zake 5 za karibuni
  (ikiwemo "ofa iliondolewa" madereva walio karibu walipokuwa wamemaliza nafasi zao).
- **Hakiki kabla ya kuwasha** (`POST /api/admin/promotions/preview`, `GET /api/admin/promotions/:id/preview`): wateja wangapi
  wanaweza kuipata sasa, safari ngapi za siku 30 zingeipata, na maonyo (tarehe ya baadaye, chombo kimoja, nauli ya chini/juu
  inayozuia safari nyingi, bajeti, nafasi za madereva, ofa nyingine inayoendelea). Inaonekana kwenye fomu unapoandika, na
  "Washa ofa" sasa inaonyesha haya kwanza kabla ya kuthibitisha.
- **Mteja anaambiwa:** `GET /api/offers?full=1` inarudisha `{ offers, notice }` — akaunti ya dereva inaambiwa "Ofa za NAYA ni kwa
  wateja tu", aliyetumia safari zote anaambiwa. Bei ya chombo kisichopata ofa inaonyesha sababu (`promoNote`, mf. "ni kwa Bodaboda tu").
  `GET /api/offers` bila `full` bado inarudisha orodha (app za zamani).
- Ofa ikiondolewa wakati wa kuagiza (madereva walio karibu wamemaliza nafasi zao), mteja sasa anapata arifa papo hapo.

## Ripoti kamili za ofisi (0.13.4)

Ofisi → **Ripoti** ina vichupo 6. Kila kimoja kina namba za muhtasari, vichujio, kutafuta, orodha nzima (safu 100 kwa mara, "Onyesha zaidi") na **Pakua Excel (CSV)** ya orodha nzima:

| Kichupo | Inaonyesha |
|---|---|
| Muhtasari | Chati za zamani: safari kila siku, mapato, saa, maeneo, madereva bora |
| Madereva | Madereva tu (chaguo-msingi: waliothibitishwa): chombo, plate, ada, online, safari, nyota, maombi aliyopewa/alikubali/alikataa/hakujibu, APK au link |
| Wateja | Waliojisajili kama wateja tu (bila usajili wa dereva): maombi, yaliyofanikiwa, aliyoghairi, alicholipa, ombi la mwisho |
| APK na link | Wateja na madereva wanaotumia APK dhidi ya link, upakuaji wa APK kila siku, na orodha ya kila kundi |
| Maombi ya safari | Kila ombi: lilifanikiwa au la, nani alilipokea, na **kila dereva aliyepewa** alifanya nini (alikubali / alikataa / hakujibu / mwingine amewahi); pamoja na jedwali la kila dereva |
| Online sasa | Madereva walio online: tayari kupokea ombi / ana ombi / safarini / hajaonekana / ada imeisha. Inasasishwa kila sekunde 15 |

- API: `GET /api/admin/ripoti/{madereva|wateja|app|maombi|online}` na `.csv` (ofisi tu).
- **APK au link:** app inatuma kichwa `x-naya-client: apk|web`. Migration `018_ripoti.sql` inaongeza `users.app_client`, `app_seen_at`, `apk_since` (columns mpya tu). Waliokwisha sajili simu ya APK (Firebase) wanahesabiwa APK mara moja; wengine wanaonekana "Haijulikani" mpaka wafungue NAYA tena.

## Kumpata dereva haraka: mawimbi (0.13.3)

- **Wimbi la 1:** ombi linaenda kwa dereva aliye karibu zaidi peke yake kwa sekunde 20 (`FIRST_OFFER_SECONDS`).
- **Wimbi la 2 na kuendelea:** akikataa au asipojibu, madereva 3 wanaofuata (`WAVE_SIZE`) wanapata ombi **kwa pamoja** kwa sekunde 30 (`OFFER_SECONDS`). Anayebonyeza "Kubali" kwanza anapata safari; wengine ombi linaondoka na wanaambiwa "Dereva mwingine amewahi kukubali ombi hili".
- Bado hakuna? Wimbi jingine la madereva 3 wanaofuata, mpaka dakika 10 (`SEARCH_TIMEOUT_SECONDS`).
- Migration `017_mawimbi.sql`: hali mpya za ombi `TAKEN` (mwingine amewahi) na `CANCELLED` (abiria/ofisi imeghairi). Hazihesabiwi kama "hakujibu", kwa hiyo dereva hawekwi offline kwa sababu yake. Hakuna data inayofutwa.

## Maombi skrini ikiwa imezimwa (0.13.2)

- APK mpya ina huduma ya chinichini (`NayaDriverService`): dereva akiwa online inatuma mahali kila sekunde 30 hata skrini ikiwa imezimwa, na inaonyesha arifa ya kudumu "NAYA: Uko online". Inasimama dereva akienda offline, akihamia upande wa abiria au akitoka.
- Server: dereva mwenye APK (token ya Firebase) anaendelea kupewa maombi mpaka dakika 30 bila ping; wa kivinjari bado ni sekunde 120 (`DRIVER_STALE_SECONDS`).
- Dereva asiyejibu maombi 2 mfululizo anawekwa offline na kuarifiwa, ili wateja wasisubiri bure.
- Kwenye kadi ya online: ujumbe wa "Pakua toleo jipya" (APK ya zamani) au "Ruhusu NAYA ifanye kazi skrini ikizimwa" (betri).
- Migration `016_dereva_chinichini.sql` inaongeza column `drivers.online_since` tu — hakuna data inayofutwa.

### Kitufe cha "Sasisha" ndani ya app (0.13.2)

- App inauliza `GET /api/app/latest` (toleo la karibuni linasomwa kutoka GitHub Releases, tag `android-1.0.N`; au `ANDROID_LATEST_VERSION_CODE`).
- Kama APK ya simu ni ya zamani, kadi "Toleo jipya la NAYA" inaonekana juu. **Sasisha** → app inapakua APK (asilimia inaonekana), inakagua ni ya `tz.naya.app` na toleo jipya zaidi, kisha Android inafungua dirisha la **Install**. Mara ya kwanza Android inaomba ruhusa "Allow from this source".
- APK za zamani (kabla ya 0.13.2) zinaonyeshwa "Pakua toleo jipya" → `/pakua/apk?sasisha=1` (kwenye browser). Masasisho hayahesabiwi kama upakuaji mpya.
- **Ufunguo wa kusaini:** APK mpya inasakinika juu ya ya zamani tu kama imesainiwa kwa ufunguo ule ule. `android-key.yml` inafungua cache ya ufunguo kila siku 3 ili GitHub isiifute.

## Kupakua app (Phase 13)

- **Link kuu ya NAYA (`/`) → `/pakua/`**: ukurasa wa kupakua. Android → kitufe "Pakua app ya NAYA" (+ hatua 4 za kusakinisha na maelezo ya onyo la Play Protect). iPhone → "Add to Home Screen". Kompyuta → QR code (`/pakua/qr.svg`).
- **`/pakua/apk`** inahesabu upakuaji (aina ya simu na muda tu) kisha inapeleka kwenye APK ya toleo jipya zaidi: `ANDROID_APK_URL` ikiwekwa, vinginevyo GitHub Releases `latest/download/NAYA.apk` (repo ni public).
- **Android kwenye browser ikifungua `/app/`**: inashauriwa kupakua kwanza. "Tumia NAYA kwenye browser badala yake" (`/app/?web=1`) inamruhusu kuendelea; hatuulizi tena kwa siku 7. Ndani ya APK hakuna ushauri huu.
- Ofisi → Muhtasari: "APK: X zimepakuliwa · Y wanaitumia". Migration `015_pakua.sql` (table mpya tu).
- Ndani ya APK (Capacitor, au WebView ya Android yenye "; wv)" kwenye user agent) ukurasa wa kupakua haumwonyeshwi mtu kamwe.

## Lugha mbili (Phase 12)

- Mtumiaji anachagua **Kiswahili | English** kwenye skrini ya kwanza, ya kujisajili, au Akaunti → Lugha / Language. Chaguo linabaki kwenye simu.
- Maandishi ya app yameandikwa kwa Kiswahili; kamusi moja **`frontend/shared/i18n/en.json`** inayatafsiri (app) na server inaitumia kwa makosa, arifa (push/FCM) na SMS kwa lugha ya mtumiaji (`users.language`, migration `014_lugha.sql`).
- Masharti: `frontend/masharti/index.html` (Kiswahili) na `frontend/masharti/en.html` (English).
- **Ukiongeza maandishi mapya kwenye app**, ongeza tafsiri yake kwenye `en.json` (`exact`: maandishi kamili; `patterns`: yenye `{}` kwa sehemu zinazobadilika). Bila tafsiri, maandishi yanaonekana kwa Kiswahili.
- Ofisi (admin) inabaki kwa Kiswahili. Majina ya maeneo, ujumbe wa ofisi na matangazo vinaonekana kama vilivyoandikwa.

## Masharti na faragha (Phase 11.2)

- Maandishi yote yako **`frontend/masharti/index.html`** (ukurasa wa umma: `/masharti/`). Sehemu: Kwa wote, Abiria, Dereva, Faragha.
- **Kujisajili:** kisanduku "Nakubali Masharti ya Huduma na Sera ya Faragha" ni lazima (server inakataa bila `acceptTerms: true`).
- **Ombi la udereva:** kisanduku cha Masharti ya Dereva kabla ya "Tuma kwa uthibitisho" (`acceptDriverTerms: true`).
- **Watumiaji wa zamani:** wakifungua app wanaona dirisha la "Nakubali, endelea" mara moja.
- **Kubadilisha masharti:** hariri ukurasa, kisha ongeza `TERMS_VERSION` / `DRIVER_TERMS_VERSION` kwenye `src/services/terms.ts` — wote wataombwa kukubali toleo jipya.
- Ofisi → Wateja → wasifu unaonyesha tarehe aliyokubali. Migration `013_masharti.sql` inaongeza safu tupu tu.

## Maoni (Phase 11.1)

- **App (abiria na dereva):** Akaunti → **Toa maoni** — nyota 1–5, mada (bei, madereva, app, usalama, wazo…) na maelezo. Chini yake anaona "Maoni yako" na hali yake (Mapya / Yamesomwa / Yamefanyiwa kazi) pamoja na **Hatua ya ofisi**.
- **Ofisi:** menyu **Maoni** — kichupo *Maoni ya app* (wastani wa nyota, vichujio, "Nimesoma" / "Imefanyiwa kazi" + maelezo yanayomfikia mtoaji kama arifa) na kichupo *Maoni ya safari* (nyota za chini na maneno ya abiria kuhusu madereva, siku 30).
- Kikomo: maoni 5 kwa mtumiaji kwa siku. Migration `012_maoni.sql` inaongeza table mpya tu.

## Ofisi kuu (Phase 11)

Ofisi (`/admin/`) ina menyu ya pembeni (kwenye simu: kitufe cha menyu juu kushoto) na **utafutaji mmoja** juu: andika jina,
namba ya simu, plate au mwanzo wa namba ya safari.

- **Muhtasari → Kazi zinazokusubiri:** dharura, wateja wanaosubiri dereva, maombi ya msaada, madereva wa kuthibitisha, ada
  zilizoisha, safari zilizokosa dereva — kila moja na kiungo cha kulishughulikia. Chati ya safari za siku 14.
- **Ramani live:** madereva walio online (kijani = huru, njano = ana safari/ombi, kijivu = hajaonekana dakika 2+) na wateja
  wanaosubiri dereva (mraba mwekundu). Inajisasisha kila sekunde 10 na kwa matukio ya papo hapo.
- **Safari → kuingilia:** safari inayotafuta dereva → "Mpe dereva maalum" (simu yake inalia kama ombi la kawaida, hata akiwa
  zaidi ya km 10); safari iliyoanza na kukwama → "Maliza safari"; kughairi kama awali. Kila hatua inaandikwa kwenye historia.
- **Wateja:** kila mtumiaji (abiria na dereva) — takwimu, safari, msaada, dharura, historia ya hatua za ofisi, maelezo ya ndani;
  vitendo: mtumie ujumbe (app + SMS), thibitisha namba yake, mpe **password ya muda** (kwa SMS, au inaonyeshwa mara moja tu
  ikiwa SMS hazijawashwa), mtoe online, simamisha / rudisha akaunti (anatolewa papo hapo).
- **Msaada:** mteja au dereva: Akaunti → Msaada → "Ripoti tatizo" (aina, safari husika, maelezo). Ofisi inajibu (majibu ya haraka
  yapo), jibu linamfikia kwenye app, arifa ya simu na kengele ya app ya Android; anaweza kujibu tena. "Jibu na utatue" inafunga ombi.
- **Matangazo:** ujumbe kwa wote / wateja / madereva / madereva walio online (SMS hiari, hadi 500 kwa tangazo).
- **Ripoti:** siku 7/30/90 — safari, thamani, zisizopata dereva, watumiaji wapya, ada; saa zenye shughuli; maeneo; madereva
  bora; **Pakua CSV** (Excel inaifungua).
- Kwenye app: Akaunti → **Badilisha password** (vifaa vingine vinatolewa).

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
- Kwa SMS: `BEEM_API_KEY`, `BEEM_SECRET_KEY`, `BEEM_SENDER_ID`
- Kwa kengele ya app ya Android: `FIREBASE_SERVICE_ACCOUNT` (na si lazima: `ANDROID_APK_URL`)
- Kwa arifa za simu: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (kutoka `npm run vapid-keys`; usizibadilishe baadaye, la sivyo simu zote zitahitaji kuwasha arifa upya)
- Migrations zinaendeshwa zenyewe server inapoanza
- Hakikisha: `/health` → `{"success":true,"status":"ok","database":"ok"}`, kisha `/admin/`
