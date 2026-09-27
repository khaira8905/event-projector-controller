import crypto from 'node:crypto';
import type { User } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { HttpError, notFound } from '../lib/errors';
import { logger } from '../lib/logger';
import type { CurrentUser } from './accounts';
import { emailEnabled, sendEmail } from './email';
import { removeEvent } from './eventRemoval';
import { createLockedLogin, deleteLogin, setLoginPassword, supabaseAdminEnabled, unlockLogin } from './supabaseAdmin';

/**
 * "Request access": someone asks for an account on the sign-in page with their name, email
 * and a password of their choice. Their Supabase login is created locked (Supabase won't sign
 * in an unconfirmed email); they prove the email with a 6-digit code (when email is set up);
 * the administrator approves or declines them in Settings, and can remove anyone later.
 */
export const accessEnabled = () => config.auth.provider === 'supabase' && config.access.enabled;

const CODE_MINUTES = 15;
const RESEND_AFTER_MS = 60_000;
const MAX_ATTEMPTS = 5;

const hashCode = (userId: string, code: string) => crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');
const supabaseId = (u: User) => (u.authId.startsWith('supabase:') ? u.authId.slice('supabase:'.length) : null);

export async function requestAccess(input: { name: string; email: string; password: string }, siteUrl: string): Promise<{ verify: boolean }> {
  if (!accessEnabled()) throw new HttpError(404, 'Requests aren’t open on this server.');
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.status === 'pending' && !existing.emailVerified && emailEnabled()) {
    // Asked before but never entered the code: send a fresh one.
    await sendCode(existing, true);
    return { verify: true };
  }
  if (existing) {
    throw new HttpError(409, existing.status === 'pending' ? 'You’ve already asked for access with this email. You’ll get an email once it’s approved.' : 'An account with this email already exists. Sign in instead.');
  }

  // At most a few new requests an hour, from everyone together: keeps spam manageable.
  const lastHour = await prisma.user.count({ where: { requestedAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (lastHour >= config.access.perHour) throw new HttpError(429, 'Lots of people are asking right now. Please try again in an hour.');

  const loginId = await createLockedLogin(email, input.password, input.name);
  let user: User;
  try {
    user = await prisma.user.create({ data: { authId: `supabase:${loginId}`, email, name: input.name, status: 'pending', requestedAt: new Date() } });
  } catch (err) {
    await deleteLogin(loginId).catch(() => {});
    throw err;
  }
  logger.info(`Access requested: ${email}`);
  if (emailEnabled()) {
    await sendCode(user, false);
    return { verify: true };
  }
  await notifyAdmin(user, siteUrl);
  return { verify: false };
}

async function sendCode(user: User, isResend: boolean) {
  if (isResend && user.verifyExpires && user.verifyExpires.getTime() - CODE_MINUTES * 60_000 + RESEND_AFTER_MS > Date.now()) {
    throw new HttpError(429, 'A code was just sent. Wait a minute before asking for another one.');
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.user.update({
    where: { id: user.id },
    data: { verifyCodeHash: hashCode(user.id, code), verifyExpires: new Date(Date.now() + CODE_MINUTES * 60_000), verifyAttempts: 0 },
  });
  const sent = await sendEmail(
    user.email,
    `Your EventControl code: ${code}`,
    `Hi${user.name ? ` ${user.name}` : ''},\n\nYour code to confirm your email for EventControl is:\n\n    ${code}\n\nIt works for ${CODE_MINUTES} minutes. If you didn't ask for access to EventControl, ignore this email.`,
  );
  if (!sent) throw new HttpError(502, 'We couldn’t send the email. Check the address and try again.');
}

export async function resendCode(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || user.status !== 'pending' || user.emailVerified || !emailEnabled()) throw new HttpError(400, 'There’s no code waiting for this email.');
  await sendCode(user, true);
}

export async function verifyCode(email: string, code: string, siteUrl: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || user.status !== 'pending' || user.emailVerified || !user.verifyCodeHash) throw new HttpError(400, 'There’s no code waiting for this email.');
  if (user.verifyAttempts >= MAX_ATTEMPTS) throw new HttpError(429, 'Too many wrong codes. Ask for a new one.');
  if (!user.verifyExpires || user.verifyExpires.getTime() < Date.now()) throw new HttpError(400, 'This code has expired. Ask for a new one.');
  const given = Buffer.from(hashCode(user.id, code.trim()));
  const expected = Buffer.from(user.verifyCodeHash);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    await prisma.user.update({ where: { id: user.id }, data: { verifyAttempts: { increment: 1 } } });
    throw new HttpError(400, 'That code isn’t right. Check the email and try again.');
  }
  const verified = await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true, verifyCodeHash: null, verifyExpires: null, verifyAttempts: 0 } });
  await notifyAdmin(verified, siteUrl);
}

/** Why a pending person can't sign in yet (shown instead of "email not confirmed"). */
export async function pendingReason(email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (user?.status !== 'pending') return null;
  if (!user.emailVerified && emailEnabled()) return 'Confirm your email first: enter the code we sent you (Request access → same email to get a new code).';
  return 'Your request is waiting for the administrator’s approval. You’ll be able to sign in once it’s approved.';
}

// ---- Forgot password ---------------------------------------------------------------

/** "Forgot your password?" works when accounts can be managed and codes can be emailed. */
export const passwordResetEnabled = () => config.auth.provider === 'supabase' && emailEnabled() && supabaseAdminEnabled();

const resetsByIp = new Map<string, number[]>();

/**
 * Emails a reset code if the address belongs to an account. The answer is the same either
 * way, so the form can't be used to find out who has an account.
 */
export async function startPasswordReset(email: string, ip: string) {
  if (!passwordResetEnabled()) throw new HttpError(404, 'Password reset isn’t available on this server. Ask your administrator.');
  const now = Date.now();
  const recent = (resetsByIp.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= 5) throw new HttpError(429, 'Too many reset requests. Please try again in an hour.');
  recent.push(now);
  resetsByIp.set(ip, recent);

  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || user.status !== 'active' || user.plan === 'demo' || !supabaseId(user)) return;
  // A code sent less than a minute ago stays valid: don't flood the inbox.
  if (user.verifyExpires && user.verifyExpires.getTime() - CODE_MINUTES * 60_000 + RESEND_AFTER_MS > now) return;
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.user.update({
    where: { id: user.id },
    data: { verifyCodeHash: hashCode(user.id, code), verifyExpires: new Date(now + CODE_MINUTES * 60_000), verifyAttempts: 0 },
  });
  await sendEmail(
    user.email,
    `Your EventControl password reset code: ${code}`,
    `Hi${user.name ? ` ${user.name}` : ''},\n\nYour code to choose a new EventControl password is:\n\n    ${code}\n\nIt works for ${CODE_MINUTES} minutes. If you didn't ask to reset your password, ignore this email: your password stays the same.`,
  );
}

export async function finishPasswordReset(email: string, code: string, password: string) {
  if (!passwordResetEnabled()) throw new HttpError(404, 'Password reset isn’t available on this server. Ask your administrator.');
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  const loginId = user && user.status === 'active' ? supabaseId(user) : null;
  if (!user || !loginId || !user.verifyCodeHash) throw new HttpError(400, 'That code isn’t right. Ask for a new one.');
  if (user.verifyAttempts >= MAX_ATTEMPTS) throw new HttpError(429, 'Too many wrong codes. Ask for a new one.');
  if (!user.verifyExpires || user.verifyExpires.getTime() < Date.now()) throw new HttpError(400, 'This code has expired. Ask for a new one.');
  const given = Buffer.from(hashCode(user.id, code.trim()));
  const expected = Buffer.from(user.verifyCodeHash);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    await prisma.user.update({ where: { id: user.id }, data: { verifyAttempts: { increment: 1 } } });
    throw new HttpError(400, 'That code isn’t right. Check the email and try again.');
  }
  await setLoginPassword(loginId, password);
  await prisma.user.update({ where: { id: user.id }, data: { verifyCodeHash: null, verifyExpires: null, verifyAttempts: 0 } });
  logger.info(`Password reset: ${user.email}`);
}

// ---- Administrator -----------------------------------------------------------------

/** The administrator: ADMIN_EMAIL, or else the first real account. */
export async function findAdmin(): Promise<User | null> {
  const admin = config.auth.adminEmail;
  if (admin) return prisma.user.findFirst({ where: { email: admin, status: 'active' } });
  return prisma.user.findFirst({ where: { plan: { not: 'demo' }, status: 'active' }, orderBy: { createdAt: 'asc' } });
}

export async function isAdmin(user: CurrentUser | null) {
  if (!user || config.auth.provider !== 'supabase') return false;
  return (await findAdmin())?.id === user.id;
}

export async function assertAdmin(user: CurrentUser | null) {
  if (!(await isAdmin(user))) throw new HttpError(403, 'Only the administrator can do this.');
}

/** Requests ready to approve, and ones still waiting for the person to enter their email code. */
export async function pendingCounts() {
  const [ready, awaitingCode] = await Promise.all([
    prisma.user.count({ where: { status: 'pending', ...(emailEnabled() ? { emailVerified: true } : {}) } }),
    emailEnabled() ? prisma.user.count({ where: { status: 'pending', emailVerified: false } }) : 0,
  ]);
  return { ready, awaitingCode };
}

export async function listPeople() {
  const users = await prisma.user.findMany({
    where: { plan: { not: 'demo' } },
    orderBy: [{ status: 'desc' }, { createdAt: 'asc' }],
    include: { _count: { select: { events: true } } },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    status: u.status,
    emailVerified: u.emailVerified,
    // Still entering their code: shown, but not something to approve yet.
    awaitingCode: u.status === 'pending' && !u.emailVerified && emailEnabled(),
    requestedAt: u.requestedAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    events: u._count.events,
  }));
}

export async function approve(id: string, siteUrl: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.plan === 'demo') throw notFound('Person not found.');
  if (user.status === 'active') return;
  const loginId = supabaseId(user);
  if (loginId) await unlockLogin(loginId);
  await prisma.user.update({ where: { id }, data: { status: 'active', verifyCodeHash: null, verifyExpires: null } });
  logger.info(`Access approved: ${user.email}`);
  void sendEmail(
    user.email,
    'You can now sign in to EventControl',
    `Hi${user.name ? ` ${user.name}` : ''},\n\nYour access to EventControl has been approved. Sign in at ${siteUrl} with your email and the password you chose.`,
  );
}

/** Declines a request, or removes someone: their login, events and files are deleted. */
export async function remove(id: string, by: CurrentUser) {
  if (id === by.id) throw new HttpError(400, 'You can’t remove your own account.');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.plan === 'demo') throw notFound('Person not found.');
  const loginId = supabaseId(user);
  if (loginId) await deleteLogin(loginId);
  const events = await prisma.event.findMany({ where: { ownerId: id }, select: { id: true } });
  for (const e of events) await removeEvent(e.id);
  await prisma.user.delete({ where: { id } });
  logger.info(`${user.status === 'pending' ? 'Request declined' : 'Account removed'}: ${user.email}`);
}

async function notifyAdmin(user: User, siteUrl: string) {
  const admin = await findAdmin();
  if (!admin || admin.id === user.id) return;
  void sendEmail(
    admin.email,
    `EventControl: ${user.name || user.email} asks for access`,
    `${user.name || 'Someone'} (${user.email}) asked for an EventControl account${user.emailVerified ? ' and confirmed their email' : ''}.\n\nApprove or decline: open ${siteUrl}, then any event → Settings → Account & sharing → People.`,
  );
}
