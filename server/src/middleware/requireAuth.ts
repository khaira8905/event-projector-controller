import type { NextFunction, Request, Response } from 'express';
import { parseCookies } from '../lib/cookies';
import { SESSION_COOKIE, authEnabled, verifySessionToken } from '../services/authService';
import { runAs, userFromSubject } from '../services/accounts';

/**
 * Protects operator API routes. Public exceptions: health, sign-in endpoints and
 * media file downloads (the projector display loads files without signing in;
 * media ids are unguessable).
 */
const PUBLIC = [/^\/health$/, /^\/keep-alive$/, /^\/auth\//, /^\/media\/[^/]+\/(file|render)$/];

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!authEnabled()) return next();
  // Sign-in endpoints accept any method; file downloads are GET only.
  if (/^\/auth\//.test(req.path) || (req.method === 'GET' && PUBLIC.some((re) => re.test(req.path)))) return next();
  const session = await verifySessionToken(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  const user = session ? await userFromSubject(session.subject, session.issuedAt) : null;
  if (!session || !user) {
    res.status(401).json({ error: 'Please sign in.', code: 'UNAUTHENTICATED' });
    return;
  }
  (req as any).session = session;
  // Everything this request does runs as this user: event queries are scoped to them.
  runAs(user, () => next());
}
