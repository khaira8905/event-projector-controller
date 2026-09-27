import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { config, googleConfigured } from '../config';
import { HttpError } from '../lib/errors';
import { logger } from '../lib/logger';
import { parseCookies } from '../lib/cookies';
import * as google from '../integrations/google';
import { signPayload, verifyPayload } from '../services/authService';
import { appUrl, cookieOptions } from '../lib/network';
import { connectionOwner, googleSignInEnabled } from '../integrations';
import { startSession } from './authController';
import { findEventOr404 } from './eventsController';
import { folderSchema, ingestFile } from './mediaController';
import { emitToOperators } from '../socket/bus';

const NONCE_COOKIE = 'ec_oauth';

interface OAuthState {
  n: string; // nonce, also in a short-lived cookie: ties the callback to this browser
  p: google.OAuthPurpose;
  r: string; // where to return in the app
  o: string; // who the connection belongs to (see ownerOf)
  e: number; // expiry
}

/** Same-origin paths only, so the callback can never be used to bounce someone elsewhere. */
const safeReturn = (value: unknown, fallback: string) => (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value.slice(0, 300) : fallback);

// Connections are personal to the browser (open access) or the installation (private mode).
const ownerOf = connectionOwner;
const signInEnabled = googleSignInEnabled;

/** The callback URL registered with Google; derived from the address the app is opened at. */
function redirectUri(req: Request) {
  if (config.google.redirectUri) return config.google.redirectUri;
  if (config.publicApiUrl) return `${config.publicApiUrl}/api/auth/google/callback`;
  const proto = (req.get('x-forwarded-proto') ?? req.protocol).split(',')[0].trim();
  const host = (req.get('x-forwarded-host') ?? req.get('host') ?? 'localhost').split(',')[0].trim();
  return `${proto}://${host}/api/auth/google/callback`;
}

async function beginOAuth(req: Request, res: Response, purpose: google.OAuthPurpose, returnTo: string) {
  if (!googleConfigured()) throw google.notConfiguredError();
  const nonce = crypto.randomBytes(16).toString('base64url');
  const state = await signPayload({ n: nonce, p: purpose, r: returnTo, o: ownerOf(req, res), e: Date.now() + 10 * 60_000 } satisfies OAuthState);
  // Lax (not Strict), so the browser sends it when Google redirects back to us.
  res.cookie(NONCE_COOKIE, nonce, cookieOptions(req, { sameSite: 'lax', maxAge: 10 * 60_000, path: '/api/auth/google' }));
  res.redirect(google.authorizationUrl({ purpose, state, redirectUri: redirectUri(req) }));
}

/** Where the app sends the browser to connect Google (private mode: needs a signed-in operator). */
export async function connect(req: Request, res: Response) {
  await beginOAuth(req, res, 'connect', safeReturn(req.query.returnTo, '/'));
}

/** "Sign in with Google" (public; only accounts listed in GOOGLE_ALLOWED_EMAILS get in). */
export async function signInStart(req: Request, res: Response) {
  if (!signInEnabled()) throw new HttpError(404, 'Sign in with Google is not enabled on this server.');
  await beginOAuth(req, res, 'signin', '/');
}

/** Google sends the browser back here with ?code&state (or ?error). */
export async function callback(req: Request, res: Response) {
  const state = await verifyPayload<OAuthState>(typeof req.query.state === 'string' ? req.query.state : undefined);
  const nonce = parseCookies(req.headers.cookie)[NONCE_COOKIE];
  res.clearCookie(NONCE_COOKIE, { path: '/api/auth/google' });
  const back = (to: string, result: string, message?: string) => {
    const url = new URL(to, 'http://x');
    url.searchParams.set('google', result);
    if (message) url.searchParams.set('message', message.slice(0, 300));
    res.redirect(appUrl(url.pathname + url.search));
  };

  if (!state || state.e < Date.now() || !nonce || nonce !== state.n) {
    return back('/', 'error', 'The Google sign-in window expired or was opened in another browser. Please try again.');
  }
  if (typeof req.query.error === 'string') {
    const cancelled = req.query.error === 'access_denied';
    return back(state.r, cancelled ? 'cancelled' : 'error', cancelled ? 'Google access was not granted.' : 'Google reported a problem. Please try again.');
  }
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) return back(state.r, 'error', 'Google did not return a sign-in code. Please try again.');

  try {
    const profile = await google.exchangeCode(code, redirectUri(req), state.p, state.o);
    if (state.p === 'signin') {
      if (!profile.emailVerified || !config.google.allowedEmails.includes(profile.email)) {
        logger.warn(`Google sign-in refused for ${profile.email}`);
        return back('/', 'denied', `${profile.email} isn’t allowed to operate this EventControl. Ask the owner to add it to GOOGLE_ALLOWED_EMAILS.`);
      }
      await startSession(req, res, `google:${profile.email}`);
      return back('/', 'signed-in');
    }
    return back(state.r, 'connected');
  } catch (err) {
    logger.warn('Google OAuth callback failed:', err instanceof Error ? err.message : err);
    return back(state.r, 'error', err instanceof HttpError ? err.message : 'Connecting to Google failed. Please try again.');
  }
}

export async function getStatus(req: Request, res: Response) {
  res.json(await google.status(ownerOf(req, res), signInEnabled()));
}

export async function disconnect(req: Request, res: Response) {
  const owner = ownerOf(req, res);
  await google.disconnect(owner);
  res.json(await google.status(owner, signInEnabled()));
}

/** What the browser needs to open Google's file picker (see google.pickerSession). */
export async function pickerSession(req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await google.pickerSession(ownerOf(req, res)));
}

const importSchema = z.object({ fileIds: z.array(z.string().min(1).max(128)).min(1).max(20), folder: z.string().optional() });

/**
 * Imports Drive files into the event. They are copied onto this computer because the app
 * converts PowerPoint to slides, works offline at the venue and must not stall mid-show
 * waiting for Google. Duplicates (same content) are detected and skipped.
 */
export async function importFromDrive(req: Request<{ id: string }>, res: Response) {
  const event = await findEventOr404(req.params.id);
  const { fileIds, folder: rawFolder } = importSchema.parse(req.body);
  const folder = folderSchema.parse(rawFolder ?? '');
  const owner = ownerOf(req, res);
  const uploaded = [];
  const duplicates = [];
  const rejected: { name: string; error: string }[] = [];
  for (const fileId of fileIds) {
    let tmp: { tmpPath: string; originalName: string; size: number } | null = null;
    try {
      tmp = await google.downloadDriveFile(owner, fileId);
      const result = await ingestFile({ eventId: event.id, ...tmp, folder, source: 'drive', sourceRef: fileId });
      if (result.status === 'uploaded') uploaded.push(result.media);
      else if (result.status === 'duplicate') result.media && duplicates.push(result.media);
      else rejected.push({ name: result.name, error: result.error });
    } catch (err) {
      // A lost connection stops the whole batch: the UI asks the operator to reconnect.
      if (err instanceof google.GoogleReconnectError) throw err;
      rejected.push({ name: tmp?.originalName ?? 'Google Drive file', error: err instanceof HttpError ? err.message : 'Import failed. Please try again.' });
    } finally {
      if (tmp) await fsp.rm(tmp.tmpPath, { force: true });
    }
  }
  if (uploaded.length) emitToOperators(event.id, 'media:changed', { eventId: event.id });
  res.status(uploaded.length ? 201 : 200).json({ uploaded, duplicates, rejected });
}
