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
};

if (problems.length > 0) {
  console.error('[config] Mipangilio haijakamilika:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
