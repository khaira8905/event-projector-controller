import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentUser } from '../services/accounts';
import * as access from '../services/accessRequests';

const requestSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name.').max(80),
  email: z.string().trim().toLowerCase().email('Please enter a valid email address.').max(200),
  password: z.string().min(8, 'Use at least 8 characters for the password.').max(72),
});
const emailSchema = z.object({ email: z.string().trim().toLowerCase().email('Please enter a valid email address.').max(200) });
const codeSchema = emailSchema.extend({ code: z.string().trim().regex(/^\d{6}$/, 'The code has 6 digits.') });

/** Where people open the site, for links in emails. */
const siteUrl = (req: Request) => `${req.protocol}://${req.get('host')}`;

// ---- Public: asking for access -----------------------------------------------------

export async function request(req: Request, res: Response) {
  const body = requestSchema.parse(req.body);
  res.status(201).json(await access.requestAccess(body, siteUrl(req)));
}

export async function verify(req: Request, res: Response) {
  const { email, code } = codeSchema.parse(req.body);
  await access.verifyCode(email, code, siteUrl(req));
  res.json({ ok: true });
}

export async function resend(req: Request, res: Response) {
  const { email } = emailSchema.parse(req.body);
  await access.resendCode(email);
  res.json({ ok: true });
}

// ---- Public: forgot password -------------------------------------------------------

const resetSchema = codeSchema.extend({ password: z.string().min(8, 'Use at least 8 characters for the password.').max(72) });

export async function forgot(req: Request, res: Response) {
  const { email } = emailSchema.parse(req.body);
  await access.startPasswordReset(email, req.ip ?? 'unknown');
  res.json({ ok: true });
}

export async function reset(req: Request, res: Response) {
  const { email, code, password } = resetSchema.parse(req.body);
  await access.finishPasswordReset(email, code, password);
  res.json({ ok: true });
}

// ---- Administrator: approving and removing people ----------------------------------

export async function listPeople(_req: Request, res: Response) {
  await access.assertAdmin(currentUser());
  res.json(await access.listPeople());
}

export async function approve(req: Request<{ id: string }>, res: Response) {
  await access.assertAdmin(currentUser());
  await access.approve(req.params.id, siteUrl(req));
  res.json({ ok: true });
}

export async function remove(req: Request<{ id: string }>, res: Response) {
  const me = currentUser();
  await access.assertAdmin(me);
  await access.remove(req.params.id, me!);
  res.status(204).end();
}

/**
 * Administrator only: which address the server sees for you, and the proxy headers it came
 * with. Visitor limits (demos, resets, sign-in tries) count per address, so on a host behind
 * several proxies this shows whether TRUST_PROXY is set right: "ip" should be your own address.
 */
export async function ipCheck(req: Request, res: Response) {
  await access.assertAdmin(currentUser());
  res.json({
    ip: req.ip,
    ips: req.ips,
    trustProxy: req.app.get('trust proxy') ?? false,
    forwardedFor: req.get('x-forwarded-for') ?? null,
    cfConnectingIp: req.get('cf-connecting-ip') ?? null,
    trueClientIp: req.get('true-client-ip') ?? null,
    remoteAddress: req.socket.remoteAddress ?? null,
  });
}
