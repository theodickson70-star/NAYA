// Mipangilio yote inasomwa hapa tu. Kitu kikikosekana, server inasimama na kutaja JINA la variable.

// Kwenye kompyuta yako: soma .env kama ipo. Kwenye Railway hakuna .env — variables zinatoka Railway.
try {
  process.loadEnvFile();
} catch {
  // hakuna .env — sawa
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[config] ${name} haipo. Iweke kwenye Railway → Variables (au kwenye .env kwa kompyuta yako).`);
    process.exit(1);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
};
