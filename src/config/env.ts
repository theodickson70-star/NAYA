// Mipangilio yote ya NAYA inasomwa hapa tu.
// Kitu cha lazima kikikosekana, server inasimama na kutaja JINA la variable (kamwe si thamani yake).

// Kwenye kompyuta yako: soma .env kama ipo. Kwenye Railway hakuna .env — variables zinatoka Railway.
try {
  process.loadEnvFile();
} catch {
  // hakuna .env — sawa
}

const problems: string[] = [];

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function required(name: string, hint: string): string {
  const value = read(name);
  if (!value) problems.push(`${name} haipo — ${hint}`);
  return value ?? '';
}

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

function parseServiceAccount(raw: string | undefined): ServiceAccount | undefined {
  if (!raw) return undefined;
  try {
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const json = JSON.parse(text) as Record<string, unknown>;
    const projectId = json.project_id;
    const clientEmail = json.client_email;
    const privateKey = json.private_key;
    if (typeof projectId !== 'string' || typeof clientEmail !== 'string' || typeof privateKey !== 'string' || !privateKey.includes('PRIVATE KEY')) {
      throw new Error('haina project_id/client_email/private_key');
    }
    const tokenUri = typeof json.token_uri === 'string' ? json.token_uri : 'https://oauth2.googleapis.com/token';
    return { projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n'), tokenUri };
  } catch {
    problems.push('FIREBASE_SERVICE_ACCOUNT si sahihi — bandika JSON nzima ya service account kutoka Firebase (au ifute)');
    return undefined;
  }
}

const nodeEnv = read('NODE_ENV') ?? 'development';
const isProduction = nodeEnv === 'production';

const jwtSecret = required('JWT_SECRET', 'tengeneza siri ndefu ya nasibu (angalau herufi 32) na iweke kwenye Railway → Variables');
if (jwtSecret && jwtSecret.length < 32) problems.push('JWT_SECRET ni fupi mno — weka angalau herufi 32 za nasibu');

export const env = {
  nodeEnv,
  isProduction,
  port: Number(read('PORT') ?? 8080),
  databaseUrl: required('DATABASE_URL', 'connection string ya Supabase (Connect → Session pooler)'),
  jwtSecret,
  jwtExpiresIn: read('JWT_EXPIRES_IN') ?? '7d',
  /** Origins za ziada zinazoruhusiwa kuita API (kurasa za NAYA zenyewe haziihitaji). Zitenganishe kwa koma. */
  corsOrigins: (read('CORS_ORIGIN') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  // Za hiari — phases zijazo (Realtime, AI). Hazihitajiki sasa.
  supabaseUrl: read('SUPABASE_URL'),
  supabaseAnonKey: read('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: read('SUPABASE_SERVICE_ROLE_KEY'),
  anthropicApiKey: read('ANTHROPIC_API_KEY'),
  // Web Push (arifa app ikiwa imefungwa). Zitengeneze kwa: npm run vapid-keys
  vapidPublicKey: read('VAPID_PUBLIC_KEY'),
  vapidPrivateKey: read('VAPID_PRIVATE_KEY'),
  vapidSubject: read('VAPID_SUBJECT') ?? 'mailto:admin@naya.co.tz',
  // SMS kupitia Beem Africa (kuthibitisha namba, kurejesha password, taarifa muhimu). Bila funguo hizi, SMS zimezimwa.
  beemApiKey: read('BEEM_API_KEY'),
  beemSecretKey: read('BEEM_SECRET_KEY'),
  /** Jina la mtumaji lililoidhinishwa na Beem (herufi ≤ 11). "INFO" ni la majaribio la Beem. */
  beemSenderId: read('BEEM_SENDER_ID') ?? 'INFO',
  /** Si lazima: anwani ya API ya SMS ya Beem (kwa majaribio tu; usiweke kwenye Railway). */
  beemBaseUrl: (read('BEEM_BASE_URL') ?? 'https://apisms.beem.africa').replace(/\/$/, ''),
  /**
   * App ya Android (kengele ya dereva app ikiwa imefungwa): "service account" ya Firebase — JSON nzima
   * (au JSON hiyo ikiwa base64). Firebase Console → Project settings → Service accounts → Generate new private key.
   */
  firebaseServiceAccount: parseServiceAccount(read('FIREBASE_SERVICE_ACCOUNT')),
  /** Si lazima: link ya kupakua APK (mf. https://github.com/<mmiliki>/NAYA/releases/latest/download/NAYA.apk). */
  androidApkUrl: read('ANDROID_APK_URL'),
};

if (env.androidApkUrl && !/^https:\/\//.test(env.androidApkUrl)) problems.push('ANDROID_APK_URL lazima ianze na https://');
if (env.beemSenderId.length > 11) problems.push('BEEM_SENDER_ID isizidi herufi 11');
if (!!env.beemApiKey !== !!env.beemSecretKey) problems.push('Weka BEEM_API_KEY na BEEM_SECRET_KEY zote mbili (au usiweke zote)');

if (problems.length > 0) {
  console.error('[config] Mipangilio haijakamilika:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
