import fs from 'node:fs';
import path from 'node:path';

// server/src (tsx) and server/dist (compiled) are both two levels below the repo root.
export const ROOT_DIR = path.resolve(__dirname, '..', '..');

// Optional settings file (cloud storage, sign-in...). See .env.example.
const envFile = path.join(ROOT_DIR, '.env');
if (process.env.NODE_ENV !== 'test' && typeof process.loadEnvFile === 'function' && fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

function authProvider(value: string | undefined): 'local' | 'supabase' | 'none' {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'local' || v === 'password') return 'local';
  if (v === 'supabase') return 'supabase';
  return 'none'; // "", "none", "open", anything unknown
}

const origin = (url: string | undefined) => {
  if (!url?.trim()) return '';
  try {
    return new URL(url.trim()).origin;
  } catch {
    return '';
  }
};

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  uploadsDir: path.resolve(process.env.UPLOADS_DIR ?? path.join(ROOT_DIR, 'uploads')),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 1024) * 1024 * 1024,
  maxFilesPerUpload: 20,
  clientDistDir: path.join(ROOT_DIR, 'client', 'dist'),
  demoAssetsDir: path.join(ROOT_DIR, 'server', 'demo-assets'),
  // Public addresses. Leave both empty when the server also hosts the UI (one link, recommended).
  // Set them only when the UI is hosted separately (e.g. a static host) from this API server:
  //   PUBLIC_APP_URL = where people open the UI, e.g. https://show.example.com
  //   PUBLIC_API_URL = where this server is reachable, e.g. https://api.example.com
  publicAppUrl: origin(process.env.PUBLIC_APP_URL),
  publicApiUrl: origin(process.env.PUBLIC_API_URL),
  // Extra browser origins allowed to call the API (comma-separated). PUBLIC_APP_URL is always allowed.
  corsOrigins: [process.env.PUBLIC_APP_URL, ...(process.env.CORS_ORIGINS ?? '').split(',')].map(origin).filter(Boolean),
  // Launching PowerPoint etc. on the host machine. Disable on shared/remote servers.
  // Only ever honoured for requests made on the server machine itself (see lib/network.ts).
  allowExternalOpen: process.env.ALLOW_EXTERNAL_OPEN !== 'false',
  seedDemo: process.env.SEED_DEMO !== 'false',

  auth: {
    // "none" (default): anyone with the link can open and use the app — no password, no account.
    // "local": optional private mode; an operator password stored (hashed) in the database.
    // "supabase": optional private mode; operators sign in with a Supabase Auth email + password.
    provider: authProvider(process.env.AUTH_PROVIDER),
    // Longest a sign-in lasts, even with the console left open (closing the tab ends it sooner).
    sessionHours: Number(process.env.SESSION_HOURS ?? 24),
    // Accounts: this person takes over events created before accounts existed (default: the first account).
    adminEmail: (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase(),
  },

  // "Try the demo" on the sign-in page (and /demo): temporary guest accounts with their own copy
  // of the demo show, deleted after DEMO_MINUTES. On by default when people sign in with accounts.
  demo: {
    enabled: process.env.DEMO ? process.env.DEMO === 'on' : authProvider(process.env.AUTH_PROVIDER) === 'supabase',
    minutes: Number(process.env.DEMO_MINUTES ?? 10),
    maxActive: Number(process.env.DEMO_MAX_ACTIVE ?? 40),
    perIpPerHour: 5,
    maxEvents: 5,
    maxFiles: 25,
    maxUploadBytes: 25 * 1024 * 1024,
  },

  // "Request access" on the sign-in page (accounts mode): people ask for an account, prove their
  // email with a code, and the administrator approves them in Settings.
  access: {
    enabled: process.env.ACCESS_REQUESTS ? process.env.ACCESS_REQUESTS === 'on' : authProvider(process.env.AUTH_PROVIDER) === 'supabase',
    perHour: Number(process.env.ACCESS_REQUESTS_PER_HOUR ?? 5),
  },

  // Outgoing email (verification codes, "new request" and "you're approved" notes) through
  // Brevo's free HTTP API. Without a key, requests still work but emails aren't verified.
  email: {
    brevoApiKey: process.env.BREVO_API_KEY ?? '',
    from: (process.env.EMAIL_FROM ?? '').trim(),
    fromName: process.env.EMAIL_FROM_NAME ?? 'EventControl',
    apiUrl: process.env.BREVO_API_URL ?? 'https://api.brevo.com/v3/smtp/email',
  },

  // Cloud storage for uploaded files. Leave SUPABASE_URL empty to keep files local only.
  supabase: {
    url: (process.env.SUPABASE_URL ?? '').replace(/\/+$/, ''),
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    anonKey: process.env.SUPABASE_ANON_KEY ?? '',
    bucket: process.env.SUPABASE_BUCKET ?? 'eventcontrol',
  },

  // Google account connection (Drive import) and optional "Sign in with Google".
  // Create an OAuth client (type "Web application") in Google Cloud Console; see README.
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    // Google's file picker: a browser API key (restricted to your site and the Picker API) and,
    // optionally, the Cloud project number (otherwise taken from the start of the client ID).
    apiKey: process.env.GOOGLE_API_KEY ?? '',
    appId: process.env.GOOGLE_APP_ID ?? '',
    // Leave empty to derive it from the address the app is opened at.
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? '',
    // Comma-separated Google accounts allowed to sign in as operator (empty = sign-in off).
    allowedEmails: (process.env.GOOGLE_ALLOWED_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    // Overridable for tests.
    authUrl: process.env.GOOGLE_AUTH_URL ?? 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: process.env.GOOGLE_TOKEN_URL ?? 'https://oauth2.googleapis.com/token',
    revokeUrl: process.env.GOOGLE_REVOKE_URL ?? 'https://oauth2.googleapis.com/revoke',
    apiUrl: (process.env.GOOGLE_API_URL ?? 'https://www.googleapis.com').replace(/\/+$/, ''),
  },

  // LibreOffice binary used to convert PPT/PPTX to PDF. Auto-detected when empty.
  sofficePath: process.env.SOFFICE_PATH ?? '',
  conversionTimeoutMs: Number(process.env.CONVERSION_TIMEOUT_SECONDS ?? 180) * 1000,
};

export const cloudStorageEnabled = () => !!(config.supabase.url && config.supabase.serviceKey);

export const googleConfigured = () => !!(config.google.clientId && config.google.clientSecret);

/** UI and API on different sites: cookies must be SameSite=None (and therefore HTTPS). */
export const crossSite = () => !!config.publicAppUrl && !!config.publicApiUrl && config.publicAppUrl !== config.publicApiUrl;
