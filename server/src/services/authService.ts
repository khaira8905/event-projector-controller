import crypto from 'node:crypto';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/errors';
import { allow, forget } from '../lib/rateLimit';
import { logger } from '../lib/logger';
import { noteAccountActive, upsertUser } from './accounts';
import { pendingReason } from './accessRequests';

/**
 * Operator authentication.
 *
 * Sessions are stateless HMAC-signed tokens kept in an HttpOnly cookie, so the
 * browser sends them automatically with REST calls, uploads and the Socket.IO
 * handshake. The signing secret lives in the database; changing the password
 * rotates it, which signs every existing session out.
 */
export const SESSION_COOKIE = 'ec_session';

const PASSWORD_KEY = 'operator_password';
const SECRET_KEY = 'session_secret';

export const authEnabled = () => config.auth.provider !== 'none';

async function getSetting(key: string) {
  return (await prisma.setting.findUnique({ where: { key } }))?.value ?? null;
}

async function setSetting(key: string, value: string) {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

let cachedSecret: string | null = null;
async function sessionSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  let secret = await getSetting(SECRET_KEY);
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    await setSetting(SECRET_KEY, secret);
  }
  cachedSecret = secret;
  return secret;
}

/** Signs a small payload (base64url JSON) so it can travel through a browser untouched. */
export async function signPayload(data: unknown): Promise<string> {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = crypto.createHmac('sha256', await sessionSecret()).update(`signed:${payload}`).digest('base64url');
  return `${payload}.${sig}`;
}

export async function verifyPayload<T>(token: string | undefined): Promise<T | null> {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', await sessionSecret()).update(`signed:${payload}`).digest();
  const actual = Buffer.from(sig, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

// Third-party tokens (e.g. Google) are stored encrypted with a key derived from a dedicated
// secret, so a copy of the database alone does not hand out access to someone's Drive.
const TOKEN_KEY = 'token_encryption_key';
let cachedTokenKey: Buffer | null = null;
async function tokenKey(): Promise<Buffer> {
  if (cachedTokenKey) return cachedTokenKey;
  let hex = process.env.TOKEN_ENCRYPTION_KEY || (await getSetting(TOKEN_KEY));
  if (!hex) {
    hex = crypto.randomBytes(32).toString('hex');
    await setSetting(TOKEN_KEY, hex);
  }
  cachedTokenKey = crypto.createHash('sha256').update(hex).digest();
  return cachedTokenKey;
}

export async function encryptSecret(plain: string): Promise<string> {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', await tokenKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export async function decryptSecret(sealed: string): Promise<string | null> {
  const [v, iv, tag, data] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', await tokenKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export { getSetting, setSetting };

async function rotateSecret() {
  cachedSecret = crypto.randomBytes(32).toString('hex');
  await setSetting(SECRET_KEY, cachedSecret);
}

// ---- Password hashing (scrypt, no native dependency) -----------------------------

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function validateNewPassword(password: string) {
  if (password.length < 6) throw new HttpError(400, 'Use at least 6 characters for the password.');
  if (password.length > 200) throw new HttpError(400, 'Password is too long.');
}

// ---- Session tokens ------------------------------------------------------------

export interface Session {
  subject: string;
  expiresAt: number;
  /** When this sign-in happened (older tokens: estimated from their expiry). */
  issuedAt: number;
}

export async function createSessionToken(subject: string, hours = config.auth.sessionHours): Promise<{ token: string; maxAgeMs: number }> {
  const maxAgeMs = Math.min(hours, config.auth.sessionHours) * 3600_000;
  const payload = Buffer.from(JSON.stringify({ s: subject, e: Date.now() + maxAgeMs, i: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', await sessionSecret()).update(payload).digest('base64url');
  return { token: `${payload}.${sig}`, maxAgeMs };
}

export async function verifySessionToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', await sessionSecret()).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.e !== 'number' || data.e < Date.now()) return null;
    const issuedAt = typeof data.i === 'number' ? data.i : data.e - config.auth.sessionHours * 3600_000;
    return { subject: String(data.s), expiresAt: data.e, issuedAt };
  } catch {
    return null;
  }
}

// ---- Providers -----------------------------------------------------------------

export async function isPasswordConfigured(): Promise<boolean> {
  if (config.auth.provider !== 'local') return true;
  return (await getSetting(PASSWORD_KEY)) !== null;
}

/** First-run: the operator chooses the password. Only allowed while none exists. */
export async function setupPassword(password: string) {
  if (config.auth.provider !== 'local') throw new HttpError(400, 'Password setup is only used with local sign-in.');
  if (await isPasswordConfigured()) throw new HttpError(409, 'A password is already set. Sign in instead.');
  validateNewPassword(password);
  await setSetting(PASSWORD_KEY, hashPassword(password));
  await rotateSecret();
  logger.info('Operator password created.');
}

export async function changePassword(current: string, next: string) {
  const stored = await getSetting(PASSWORD_KEY);
  if (!stored || !verifyPassword(current, stored)) throw new HttpError(401, 'Current password is incorrect.');
  validateNewPassword(next);
  await setSetting(PASSWORD_KEY, hashPassword(next));
  await rotateSecret();
}

/** Returns the session subject on success ("user:<id>" for accounts, "operator" for the local password). */
export async function authenticate(credentials: { email?: string; password: string }): Promise<string> {
  if (config.auth.provider === 'supabase') {
    let identity: Awaited<ReturnType<typeof authenticateWithSupabase>>;
    try {
      identity = await authenticateWithSupabase(credentials.email ?? '', credentials.password);
    } catch (err) {
      // Asked for access and not approved yet: say so, instead of "email not confirmed".
      const reason = err instanceof HttpError && err.code === 'EMAIL_NOT_CONFIRMED' ? await pendingReason(credentials.email ?? '') : null;
      throw reason ? new HttpError(403, reason, 'PENDING') : err;
    }
    noteAccountActive(identity.authId);
    const user = await upsertUser(identity);
    return `user:${user.id}`;
  }
  const stored = await getSetting(PASSWORD_KEY);
  if (!stored) throw new HttpError(409, 'No password has been set yet.', 'SETUP_REQUIRED');
  if (!verifyPassword(credentials.password, stored)) throw new HttpError(401, 'Incorrect password.');
  return 'operator';
}

/** Verifies an email/password against Supabase Auth (GoTrue) and returns who it is. */
async function authenticateWithSupabase(email: string, password: string): Promise<{ authId: string; email: string; name: string }> {
  const { url, anonKey } = config.supabase;
  if (!url || !anonKey) {
    throw new HttpError(503, 'Sign-in isn’t set up on this server yet: the administrator needs to add SUPABASE_URL and SUPABASE_ANON_KEY (Render → Environment), then it works.');
  }
  let res: Response;
  try {
    res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.error('Supabase sign-in request failed:', err);
    throw new HttpError(503, 'Cannot reach the sign-in service. Check the internet connection.');
  }
  if (!res.ok) {
    const body: any = await res.json().catch(() => ({}));
    if (/not confirmed/i.test(String(body?.msg ?? body?.error_description ?? ''))) {
      throw new HttpError(401, 'This account’s email isn’t confirmed yet. Ask your administrator to confirm it in Supabase.', 'EMAIL_NOT_CONFIRMED');
    }
    throw new HttpError(401, 'Incorrect email or password.');
  }
  const data: any = await res.json().catch(() => ({}));
  const u = data?.user ?? {};
  if (!u.id) throw new HttpError(502, 'The sign-in service returned an unexpected answer. Please try again.');
  const meta = u.user_metadata ?? {};
  return { authId: `supabase:${u.id}`, email: String(u.email ?? email), name: String(meta.full_name ?? meta.name ?? '') };
}

/** Resets local sign-in so the next visit asks for a new password. */
export async function resetPassword() {
  await prisma.setting.deleteMany({ where: { key: { in: [PASSWORD_KEY, SECRET_KEY] } } });
  cachedSecret = null;
}

// ---- Brute-force protection ----------------------------------------------------

export function checkRateLimit(ip: string) {
  if (!allow(`login:${ip}`, 10, 60_000)) throw new HttpError(429, 'Too many sign-in attempts. Wait a minute and try again.');
}

export function clearRateLimit(ip: string) {
  forget(`login:${ip}`);
}
