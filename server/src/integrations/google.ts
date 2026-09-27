import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config, googleConfigured } from '../config';
import { HttpError } from '../lib/errors';
import { logger } from '../lib/logger';
import { decryptSecret, encryptSecret, getSetting, setSetting } from '../services/authService';
import { prisma } from '../lib/prisma';

/**
 * Google account connection for EventControl.
 *
 * Server-side OAuth (authorization-code flow): the browser only ever sees Google's consent
 * page and our own pages. The client secret and the tokens stay on the server; tokens are
 * stored encrypted. Each connection belongs to an "owner": the browser that connected it when the
 * app is open to anyone with the link, or the whole installation when operators sign in.
 *
 * Built as a small, self-contained "integration" so another provider can sit next to it
 * later (see services/integrations.ts).
 */

/**
 * Drive access is "drive.file": EventControl only sees the files a person picks in Google's
 * own file picker. It's a non-sensitive scope, so Google shows no "unverified app" warning and
 * sets no limit on how many people can connect. Connections made earlier with read access to
 * the whole Drive still work.
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const LEGACY_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const PROFILE_SCOPES = ['openid', 'email', 'profile'];
const accountKey = (owner: string) => (owner === 'installation' ? 'integration.google' : `integration.google:${owner}`);

export interface GoogleAccount {
  email: string;
  name: string;
  picture: string | null;
  scopes: string[];
  connectedAt: number;
}

interface StoredAccount extends GoogleAccount {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
}

/** Error the UI understands: the connection must be made again. */
export class GoogleReconnectError extends HttpError {
  constructor(message = 'Your Google connection has expired or was removed. Connect Google again in Settings → File sources.') {
    super(409, message);
    this.code = 'GOOGLE_RECONNECT';
  }
}

export function notConfiguredError() {
  return new HttpError(
    503,
    'Google isn’t set up on this EventControl server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the .env file (see README → Google Drive), then restart.',
  );
}

// ---- Stored account ----------------------------------------------------------------

async function loadAccount(owner: string): Promise<StoredAccount | null> {
  const sealed = await getSetting(accountKey(owner));
  if (!sealed) return null;
  const json = await decryptSecret(sealed);
  if (!json) return null;
  try {
    return JSON.parse(json) as StoredAccount;
  } catch {
    return null;
  }
}

async function saveAccount(owner: string, account: StoredAccount) {
  await setSetting(accountKey(owner), await encryptSecret(JSON.stringify(account)));
}

async function forgetAccount(owner: string) {
  await prisma.setting.deleteMany({ where: { key: accountKey(owner) } });
}

export async function getAccount(owner: string): Promise<GoogleAccount | null> {
  const a = await loadAccount(owner);
  return a ? { email: a.email, name: a.name, picture: a.picture, scopes: a.scopes, connectedAt: a.connectedAt } : null;
}

export async function status(owner: string, signInEnabled: boolean) {
  const account = await getAccount(owner);
  return {
    configured: googleConfigured(),
    connected: !!account,
    account,
    drive: !!account?.scopes.some((s) => s === DRIVE_SCOPE || s === LEGACY_DRIVE_SCOPE),
    signInEnabled,
  };
}

// ---- OAuth -------------------------------------------------------------------------

export type OAuthPurpose = 'connect' | 'signin';

export function authorizationUrl(opts: { purpose: OAuthPurpose; state: string; redirectUri: string; loginHint?: string }) {
  const scopes = opts.purpose === 'connect' ? [...PROFILE_SCOPES, DRIVE_SCOPE] : PROFILE_SCOPES;
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state: opts.state,
    include_granted_scopes: 'true',
    // A refresh token is only needed to keep reading Drive later.
    ...(opts.purpose === 'connect' ? { access_type: 'offline', prompt: 'consent' } : { prompt: 'select_account' }),
    ...(opts.loginHint ? { login_hint: opts.loginHint } : {}),
  });
  return `${config.google.authUrl}?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(config.google.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, ...body }),
    });
  } catch {
    throw new HttpError(502, 'Couldn’t reach Google. Check this computer’s internet connection and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    if (data.error === 'invalid_grant') throw new GoogleReconnectError();
    logger.warn('Google token request failed:', data.error, data.error_description);
    throw new HttpError(502, 'Google refused the request. Try connecting again; if it keeps failing, check the Google client settings (README → Google Drive).');
  }
  return data;
}

async function fetchProfile(accessToken: string) {
  const res = await fetch(`${config.google.apiUrl}/oauth2/v3/userinfo`, { headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => null);
  if (!res?.ok) throw new HttpError(502, 'Couldn’t read your Google profile. Please try again.');
  const p = (await res.json()) as { email?: string; email_verified?: boolean; name?: string; picture?: string };
  if (!p.email) throw new HttpError(502, 'Google didn’t share an email address for this account.');
  return { email: p.email.toLowerCase(), emailVerified: p.email_verified !== false, name: p.name ?? p.email, picture: p.picture ?? null };
}

/** Finishes the OAuth dance: exchanges the code and returns the Google profile. */
export async function exchangeCode(code: string, redirectUri: string, purpose: OAuthPurpose, owner: string) {
  const tokens = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri });
  const profile = await fetchProfile(tokens.access_token);
  if (purpose === 'connect') {
    const previous = await loadAccount(owner);
    const refreshToken = tokens.refresh_token ?? (previous?.email === profile.email ? previous.refreshToken : undefined);
    if (!refreshToken) throw new HttpError(502, 'Google didn’t grant offline access. Please try connecting again.');
    const scopes = (tokens.scope ?? '').split(' ').filter(Boolean);
    await saveAccount(owner, {
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
      scopes,
      connectedAt: Date.now(),
      refreshToken,
      accessToken: tokens.access_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
    logger.info(`Google account connected: ${profile.email}`);
  }
  return profile;
}

export async function disconnect(owner: string) {
  const account = await loadAccount(owner);
  await forgetAccount(owner);
  if (account) {
    // Tell Google too, so the access is gone from the user's account page. Best effort.
    await fetch(config.google.revokeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: account.refreshToken }),
    }).catch(() => undefined);
    logger.info(`Google account disconnected: ${account.email}`);
  }
}

/** A valid access token (good for at least `minValidMs`), refreshed when needed. */
async function accessToken(owner: string, minValidMs = 60_000): Promise<{ token: string; expiresAt: number }> {
  if (!googleConfigured()) throw notConfiguredError();
  const account = await loadAccount(owner);
  if (!account) throw new GoogleReconnectError('Google Drive isn’t connected. Connect it in Settings → File sources.');
  if (account.expiresAt - Date.now() > minValidMs) return { token: account.accessToken, expiresAt: account.expiresAt };
  try {
    const t = await tokenRequest({ refresh_token: account.refreshToken, grant_type: 'refresh_token' });
    const expiresAt = Date.now() + t.expires_in * 1000;
    await saveAccount(owner, { ...account, accessToken: t.access_token, expiresAt });
    return { token: t.access_token, expiresAt };
  } catch (err) {
    // Revoked, or the password changed: forget it so the UI shows "Connect" again.
    if (err instanceof GoogleReconnectError) await forgetAccount(owner);
    throw err;
  }
}

async function driveFetch(owner: string, url: string): Promise<Response> {
  const { token } = await accessToken(owner);
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new HttpError(502, 'Couldn’t reach Google Drive. Check the internet connection and try again.');
  }
  if (res.status === 401) {
    await forgetAccount(owner);
    throw new GoogleReconnectError();
  }
  if (res.status === 403) throw new HttpError(403, 'Google Drive didn’t allow this. Make sure you gave EventControl permission to see your files when connecting.');
  if (res.status === 404) throw new HttpError(404, 'That file is no longer in your Google Drive (or it isn’t shared with this account).');
  if (!res.ok) throw new HttpError(502, 'Google Drive returned an error. Please try again in a moment.');
  return res;
}

// ---- Drive -------------------------------------------------------------------------

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PPT = 'application/vnd.ms-powerpoint';
const PDF = 'application/pdf';
const SLIDES = 'application/vnd.google-apps.presentation';
const IMPORTABLE = [PPTX, PPT, PDF, SLIDES];

/**
 * What the browser needs to open Google's file picker for this person: a short-lived access
 * token limited to drive.file (only files they pick), the Cloud project number (so picked
 * files are shared with this app) and the optional browser API key. The client secret and the
 * refresh token never leave the server.
 */
export async function pickerSession(owner: string) {
  const account = await loadAccount(owner);
  if (!account?.scopes.some((s) => s === DRIVE_SCOPE || s === LEGACY_DRIVE_SCOPE)) {
    throw new GoogleReconnectError('Connect Google Drive first (Settings → File sources).');
  }
  // Valid for the whole time the picker is likely to stay open.
  const { token, expiresAt } = await accessToken(owner, 10 * 60_000);
  return {
    accessToken: token,
    expiresAt,
    // The project number is the start of the OAuth client ID ("123456789012-abc….apps…").
    appId: config.google.appId || config.google.clientId.split('-')[0],
    apiKey: config.google.apiKey || null,
  };
}

/**
 * Brings one Drive file onto this computer so it can be converted, shown offline and
 * controlled slide by slide. Google Slides are exported as PowerPoint.
 */
export async function downloadDriveFile(owner: string, fileId: string): Promise<{ tmpPath: string; originalName: string; size: number }> {
  if (!/^[\w-]{10,128}$/.test(fileId)) throw new HttpError(400, 'Invalid Google Drive file.');
  const metaRes = await driveFetch(owner, `${config.google.apiUrl}/drive/v3/files/${fileId}?fields=id,name,mimeType,size&supportsAllDrives=true`);
  const meta = (await metaRes.json()) as { name?: string; mimeType?: string; size?: string };
  const mime = meta.mimeType ?? '';
  if (!IMPORTABLE.includes(mime)) throw new HttpError(415, 'Only PowerPoint, Google Slides and PDF files can be imported from Drive.');
  if (meta.size && Number(meta.size) > config.maxUploadBytes) throw new HttpError(413, 'This file is larger than the upload limit (MAX_UPLOAD_MB).');

  let name = (meta.name ?? 'Presentation').replace(/[\u0000-\u001f\u007f/\\]/g, '').slice(0, 180) || 'Presentation';
  const ext = mime === SLIDES || mime === PPTX ? '.pptx' : mime === PPT ? '.ppt' : '.pdf';
  if (!name.toLowerCase().endsWith(ext)) name += ext;

  const url =
    mime === SLIDES
      ? `${config.google.apiUrl}/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(PPTX)}`
      : `${config.google.apiUrl}/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
  const res = await driveFetch(owner, url);
  if (!res.body) throw new HttpError(502, 'Google Drive sent an empty file.');
  const tmpPath = path.join(os.tmpdir(), `ec-drive-${crypto.randomBytes(8).toString('hex')}${ext}`);
  let bytes = 0;
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  body.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > config.maxUploadBytes) body.destroy(new HttpError(413, 'This file is larger than the upload limit (MAX_UPLOAD_MB).'));
  });
  try {
    await pipeline(body, fs.createWriteStream(tmpPath));
  } catch (err) {
    await fsp.rm(tmpPath, { force: true });
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, 'The download from Google Drive was interrupted. Please try again.');
  }
  return { tmpPath, originalName: name, size: bytes };
}
