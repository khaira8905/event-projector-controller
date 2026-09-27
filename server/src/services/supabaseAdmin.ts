import { config } from '../config';
import { HttpError } from '../lib/errors';
import { logger } from '../lib/logger';
import { serviceHeaders } from './storage/supabaseStorage';

/**
 * Supabase Auth's admin API (service key, server only): creating, confirming and deleting the
 * logins of people who ask for access. Passwords go straight to Supabase and are never kept here.
 */
export const supabaseAdminEnabled = () => !!(config.supabase.url && config.supabase.serviceKey);

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const { url, serviceKey } = config.supabase;
  if (!url || !serviceKey) throw new HttpError(503, 'Accounts can’t be managed yet: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed.');
  let res: Response;
  try {
    res = await fetch(`${url}/auth/v1/admin/users${path}`, {
      method,
      headers: serviceHeaders(serviceKey, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.error('Supabase admin request failed:', err);
    throw new HttpError(503, 'Can’t reach the account service right now. Please try again.');
  }
  const data: any = await res.json().catch(() => ({}));
  if (res.ok) return data;
  if (method === 'DELETE' && res.status === 404) return null; // already gone
  const message = String(data?.msg ?? data?.message ?? data?.error_description ?? '');
  if (res.status === 422 && /already|exists|registered/i.test(message + (data?.error_code ?? ''))) {
    throw new HttpError(409, 'An account with this email already exists. Sign in instead, or ask the administrator.');
  }
  if (/password/i.test(message)) throw new HttpError(400, `Choose a stronger password: ${message}`);
  logger.warn(`Supabase admin ${method} failed (${res.status}): ${message}`);
  throw new HttpError(502, 'The account service refused the request. Please try again.');
}

/** A locked login: Supabase refuses to sign it in until it's confirmed (on approval). */
export async function createLockedLogin(email: string, password: string, name: string): Promise<string> {
  const user = await call('POST', '', { email, password, email_confirm: false, user_metadata: { full_name: name } });
  if (!user?.id) throw new HttpError(502, 'The account service returned an unexpected answer.');
  return String(user.id);
}

export async function unlockLogin(supabaseId: string) {
  await call('PUT', `/${encodeURIComponent(supabaseId)}`, { email_confirm: true });
}

export async function deleteLogin(supabaseId: string) {
  await call('DELETE', `/${encodeURIComponent(supabaseId)}`);
}

export async function setLoginPassword(supabaseId: string, password: string) {
  await call('PUT', `/${encodeURIComponent(supabaseId)}`, { password });
}
