import type { Request, Response } from 'express';
import { z } from 'zod';
import { config, googleConfigured } from '../config';
import { parseCookies } from '../lib/cookies';
import * as auth from '../services/authService';
import { cookieOptions } from '../lib/network';
import { userFromSubject } from '../services/accounts';
import * as demoAccounts from '../services/demoAccounts';
import { demoEnabled } from '../services/demoAccounts';

async function accountSummary(subject: string) {
  const u = await userFromSubject(subject);
  return u ? { email: u.email, name: u.name, plan: u.plan, ...(u.demoEndsAt ? { demoEndsAt: u.demoEndsAt } : {}) } : null;
}

const passwordSchema = z.object({ password: z.string().min(1, 'Password is required').max(200) });
const loginSchema = z.object({ email: z.string().trim().max(200).optional(), password: z.string().min(1, 'Password is required').max(200) });
const changeSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });

export async function startSession(req: Request, res: Response, subject: string, hours?: number) {
  const { token } = await auth.createSessionToken(subject, hours);
  // No maxAge: a browser-session cookie, gone when the browser closes. The token itself still
  // expires after SESSION_HOURS, and the console signs out when its tab closes (AuthGate).
  res.cookie(auth.SESSION_COOKIE, token, cookieOptions(req, { sameSite: 'strict', path: '/' }));
}

export async function status(req: Request, res: Response) {
  const session = await auth.verifySessionToken(parseCookies(req.headers.cookie)[auth.SESSION_COOKIE]);
  // Signed-in account (accounts mode): shown in the console and used for per-person settings.
  // No account behind a valid cookie means it was removed: that session is over.
  const account = session ? await accountSummary(session.subject) : null;
  if (session && !account) res.clearCookie(auth.SESSION_COOKIE, { path: '/' });
  res.json({
    provider: config.auth.provider,
    enabled: auth.authEnabled(),
    configured: await auth.isPasswordConfigured(),
    authenticated: !auth.authEnabled() || !!account,
    user: account ? session!.subject : null,
    account,
    // "Continue with Google" on the sign-in page.
    google: auth.authEnabled() && googleConfigured() && config.google.allowedEmails.length > 0,
    // "Try the demo" on the sign-in page.
    demo: demoEnabled(),
  });
}

/** "Try the demo": a fresh guest account with its own copy of the demo show. */
export async function startDemo(req: Request, res: Response) {
  const { userId, eventId } = await demoAccounts.startDemo(req.ip ?? 'unknown');
  await startSession(req, res, `user:${userId}`, config.demo.hours);
  res.status(201).json({ ok: true, eventId });
}

export async function setup(req: Request, res: Response) {
  const { password } = passwordSchema.parse(req.body);
  await auth.setupPassword(password);
  await startSession(req, res, 'operator');
  res.status(201).json({ ok: true });
}

export async function login(req: Request, res: Response) {
  const ip = req.ip ?? 'unknown';
  auth.checkRateLimit(ip);
  const body = loginSchema.parse(req.body);
  const subject = await auth.authenticate(body);
  auth.clearRateLimit(ip);
  await startSession(req, res, subject);
  res.json({ ok: true, user: subject });
}

export async function logout(_req: Request, res: Response) {
  res.clearCookie(auth.SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
}

export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = changeSchema.parse(req.body);
  await auth.changePassword(currentPassword, newPassword);
  // Rotating the secret signed everyone out; keep this operator signed in.
  await startSession(req, res, 'operator');
  res.json({ ok: true });
}
