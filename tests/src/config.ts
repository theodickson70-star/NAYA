// Mipangilio kutoka environment variables (Railway → Variables). Siri haziandikwi kwenye code.
const isProd = process.env.NODE_ENV === 'production';

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] Variable ${name} haijawekwa. Iweke kwenye Railway > Variables.`);
    process.exit(1);
  }
  return v;
}

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 3000),
  host: '0.0.0.0',
  databaseUrl: required('DATABASE_URL'),
  /** Cookie za "Secure" (HTTPS tu). Railway inatumia HTTPS. Kwa kompyuta yako (http://localhost) weka COOKIE_SECURE=false. */
  cookieSecure: process.env.COOKIE_SECURE !== 'false',
  sessionDays: 7,
  appName: 'PayPoint',
  tagline: 'Kituo Chako cha Pesa',
  company: 'DUKALANGU SOLUTION GROUP',
};
