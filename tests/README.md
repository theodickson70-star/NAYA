# WakalaLink

Mfumo wa mawakala wa kutuma na kutoa pesa (M-Pesa, Mixx by Yas, Airtel Money, HaloPesa, T-Pesa).
Wakala anarekodi miamala na salio kila siku, na mmiliki anasimamia vibanda vyake vyote akiwa popote.

**DUKALANGU SOLUTION GROUP** • Bomavillage, Urambo – Tabora

---

## Kinachofanya kazi

**Wakala (simu ya Android)**
- Kufungua siku: cash ya kuanzia na float ya kila laini
- Kitufe kikubwa cha **KUWEKA** na **KUTOA**: mtandao, kiasi, simu ya mteja, Ref. Kamisheni inahesabiwa yenyewe.
- Mfumo unazuia muamala usiowezekana, kwa mfano kuweka zaidi ya float iliyopo
- Marekebisho: mtaji kuingia, kupeleka cash kwa mmiliki, kununua au kuuza float, kupokea au kutuma float, na matumizi
- Salio la cash na la float ya kila mtandao linaonekana papo hapo
- Kufuta muamala uliokosewa: lazima aandike sababu, na mmiliki anapata arifa
- **Kufunga siku kwa kuhesabu bila kuona kiasi kinachotarajiwa (blind count):** wakala anaandika cash na float halisi bila kuona mfumo unatarajia kiasi gani. Mfumo ndio unaolinganisha na kuonyesha upungufu au ziada.

**Mmiliki (simu au kompyuta kupitia web)**
- Dashibodi **live** (realtime): kila kibanda kiko wazi au kimefungwa, wakala ni nani, cash na float kwa kila mtandao, miamala na kamisheni ya leo
- Kufungua kibanda kimoja kunaonyesha miamala yote na upatanisho (hesabu ya mfumo vs hesabu halisi)
- Ripoti kwa kipindi chochote: jumla, kwa mtandao, kwa kibanda, kwa siku, na upungufu wa kila zamu
- Arifa ndani ya app (SMS kupitia RodSMS zitaongezwa baadaye) kwa: float ndogo, cash ndogo, muamala mkubwa, muamala kufutwa, upungufu wakati wa kufunga siku, na ripoti ya kila siku saa 3 usiku
- Mipangilio: vibanda na laini zake, mawakala (kuongeza, kupangia kibanda, kuzima akaunti), viwango vya kamisheni, na viwango vya tahadhari
- Usajili wa SaaS kupitia **Snippe** (USSD push). Kuna siku 14 za majaribio bure.

**Mipango (unaweza kubadilisha bei kwenye jedwali la `plans`):**
Mwanzo TSh 10,000 (kibanda 1) • Kati TSh 25,000 (hadi vibanda 5) • Biashara TSh 50,000 (bila kikomo)

---

## Muundo wa project

```
wakalalink/
├── app/                     ← Flutter app (wakala + mmiliki, Android + Web)
│   ├── pubspec.yaml
│   └── lib/
│       ├── main.dart, config.dart
│       ├── services/  api.dart, format.dart
│       ├── widgets/   common.dart
│       └── screens/   login, agent/*, owner/*
└── supabase/
    ├── migrations/001_wakalalink.sql   ← database yote + RLS + RPC
    ├── cron.sql                        ← ratiba za SMS
    └── functions/  create-agent, subscribe, snippe-webhook, send-sms, daily-report
```

---

## HATUA ZA KUWEKA (SETUP) — kwenye akaunti za NAYA

WakalaLink inatumia **Supabase ya NAYA** (project ileile) na **repo ya GitHub ya NAYA**. Railway haitumiki tena.
Data ya NAYA iko kwenye schema `naya` na haiguswi; WakalaLink inakaa kwenye schema `public`.
Code yote ya NAYA imehifadhiwa kwenye GitHub kama tag **`naya-final`** (`git checkout naya-final` kuiona).

**SMS bado hazijawekwa** (zitaunganishwa na RodSMS baadaye). Kwa sasa tahadhari zote zinaonekana kwenye **Arifa**
ndani ya app. Usiendeshe `supabase/cron.sql` wala ku-deploy `send-sms` / `daily-report` mpaka SMS ziwekwe.

### 1. Supabase (project ya NAYA)
1. **SQL Editor** → New query → bandika `supabase/migrations/001_wakalalink.sql` yote → **Run** (mara moja tu).
2. **Authentication → Sign In / Providers → Email**: hakikisha Email imewashwa, na zima **"Confirm email"** ili wamiliki waanze bila kuthibitisha barua pepe.
3. **Settings → API → Exposed schemas** (Data API): iwe `public` peke yake. **`naya` isiwe humo**, ili data ya NAYA isifikiwe kwa anon key.
4. **Settings → API**: nakili **Project URL** na **anon public key** (zinatumika kwenye app).

### 2. Function ya kuongeza mawakala (PowerShell, ndani ya folder la repo)
```powershell
npm i -g supabase
supabase login
supabase link --project-ref PROJECT_REF_YA_NAYA
supabase functions deploy create-agent
```
`PROJECT_REF` ni sehemu ya Project URL: `https://PROJECT_REF.supabase.co`. Function hii haihitaji secret yoyote ya ziada.

Usajili wa kulipia (`subscribe`, `snippe-webhook`) bado si lazima: kila mmiliki anapata siku 14 za majaribio bure.

### 3. Flutter app
```powershell
cd app
flutter create --org com.dukalangu --project-name wakalalink --platforms android,web .
flutter pub get
```
(`flutter create .` inaongeza folder za android/web tu. Haibadilishi `lib/`.)

Fungua `android/app/src/main/AndroidManifest.xml` na uongeze mstari huu juu ya `<application`:
```xml
<uses-permission android:name="android.permission.INTERNET"/>
```

Kuona mfumo haraka kwenye kompyuta (Chrome):
```powershell
flutter run -d chrome --dart-define=SUPABASE_URL=https://PROJECT_REF.supabase.co --dart-define=SUPABASE_ANON_KEY=eyJ...
```

Build:
```powershell
flutter build apk --release --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_ANON_KEY=...
flutter build web --release --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_ANON_KEY=...
```
APK ni kwa mawakala. Web (`build/web`) unaweza kuiweka Vercel ili wamiliki waitumie kwenye kompyuta.
Anon key si siri (inalindwa na RLS), lakini **service_role key** isiwekwe kwenye app wala GitHub.

Inahitaji Flutter 3.27 au mpya zaidi.

### Baadaye: SMS (RodSMS)
Zikiwa tayari: weka `smsEnabled = true` kwenye `app/lib/config.dart`, weka secrets kwenye Supabase, deploy `send-sms` na `daily-report`, kisha endesha `supabase/cron.sql`.

---

## Jinsi ya kutumia (mtiririko)
1. **Mmiliki** anajisajili → anajaza jina la biashara na simu
2. Mipangilio → **Vibanda** → anaongeza kibanda na kuchagua laini zake
3. Mipangilio → **Mawakala** → anaongeza wakala (barua pepe + nenosiri) na kumpangia kibanda
4. Mipangilio → **Kamisheni** → anaweka viwango vya kila mtandao
5. **Wakala** anaingia → anafungua siku → anarekodi miamala → jioni anafunga siku
6. Mmiliki anaona kila kitu papo hapo na anapokea arifa za tahadhari

## Hesabu (jinsi mfumo unavyopatanisha)
| Tukio | Cash | Float ya mtandao |
|---|---|---|
| Kuweka (deposit) | + | − |
| Kutoa (withdrawal) | − | + |
| Kununua float | − | + |
| Kuuza float | + | − |
| Mtaji kuingia / cash kwa mmiliki | + / − | |
| Float kuingia / kutoka | | + / − |
| Matumizi | − | |

Upungufu = Kiasi halisi alichohesabu wakala − Kiasi mfumo unachotarajia
