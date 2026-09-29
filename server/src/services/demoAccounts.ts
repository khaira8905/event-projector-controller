import crypto from 'node:crypto';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/errors';
import { allow } from '../lib/rateLimit';
import { logger } from '../lib/logger';
import { currentUser } from './accounts';
import { createDemoEvent } from './demoSeed';
import { copyEvent } from './eventCopy';
import { removeEvent } from './eventRemoval';

/**
 * "Try the demo": a visitor gets a temporary guest account with its own copy of the demo
 * show, private like any account. Guests can do everything an operator can on a small
 * budget, except connect outside services. Guest accounts and everything in them are
 * deleted after DEMO_MINUTES.
 */
export const DEMO_PLAN = 'demo';

export const demoEnabled = () => config.auth.provider !== 'none' && config.demo.enabled;
export const isDemo = (user = currentUser()) => user?.plan === DEMO_PLAN;
export const demoEndsAt = (createdAt: Date) => createdAt.getTime() + config.demo.minutes * 60_000;

export async function startDemo(ip: string): Promise<{ userId: string; eventId: string }> {
  if (!demoEnabled()) throw new HttpError(404, 'The demo isn’t available on this server.');
  if ((await prisma.user.count({ where: { plan: DEMO_PLAN } })) >= config.demo.maxActive) {
    throw new HttpError(503, 'The demo is busy right now. Please try again in a little while.');
  }
  if (!allow(`demo:${ip}`, config.demo.perIpPerHour)) {
    throw new HttpError(429, 'You’ve started several demos in the last hour. Carry on in the one you have, or try again later.');
  }

  const id = crypto.randomBytes(6).toString('hex');
  const user = await prisma.user.create({
    // createdAt from this server's clock: the demo's end is counted from it.
    data: { authId: `demo:${id}`, email: `guest-${id}@demo.eventcontrol`, name: 'Demo guest', plan: DEMO_PLAN, createdAt: new Date(), lastLoginAt: new Date() },
  });
  try {
    const eventId = await demoEventFor(user.id);
    logger.info(`Demo started (${await prisma.user.count({ where: { plan: DEMO_PLAN } })} active).`);
    return { userId: user.id, eventId };
  } catch (err) {
    await removeDemo(user.id).catch(() => {});
    throw err;
  }
}

// ---- Showcase ----------------------------------------------------------------------

/**
 * The administrator can pick one of their own events as the showcase: every demo visitor
 * then gets a private copy of it instead of the built-in sample. Stored as a setting.
 */
const SHOWCASE_KEY = 'demo.showcaseEventId';

export async function getShowcaseEventId(): Promise<string | null> {
  return (await prisma.setting.findUnique({ where: { key: SHOWCASE_KEY } }))?.value || null;
}

export async function setShowcaseEventId(eventId: string | null, ownerId: string) {
  if (eventId === null) {
    await prisma.setting.deleteMany({ where: { key: SHOWCASE_KEY } });
    return;
  }
  const event = await prisma.event.findFirst({ where: { id: eventId, ownerId }, select: { id: true } });
  if (!event) throw new HttpError(404, 'Event not found.');
  await prisma.setting.upsert({ where: { key: SHOWCASE_KEY }, create: { key: SHOWCASE_KEY, value: eventId }, update: { value: eventId } });
  logger.info('Demo showcase event changed.');
}

/** A copy of the showcase event, or the built-in sample if there's none (or it can't be copied). */
async function demoEventFor(userId: string): Promise<string> {
  const showcase = await getShowcaseEventId();
  if (showcase && (await prisma.event.count({ where: { id: showcase } }))) {
    try {
      return await copyEvent(showcase, userId);
    } catch (err) {
      logger.warn('Couldn’t copy the showcase event for a demo; using the sample instead.', err);
    }
  }
  return createDemoEvent(userId);
}

// ---- Budget ------------------------------------------------------------------------

export async function checkDemoEventLimit() {
  const user = currentUser();
  if (!isDemo(user)) return;
  if ((await prisma.event.count({ where: { ownerId: user!.id } })) >= config.demo.maxEvents) {
    throw new HttpError(403, `The demo is limited to ${config.demo.maxEvents} events. Delete one to make another.`);
  }
}

/** Before an upload is received: keeps demo uploads small. */
export async function checkDemoUpload(contentLength: number) {
  const user = currentUser();
  if (!isDemo(user)) return;
  const mb = Math.round(config.demo.maxUploadBytes / 1024 / 1024);
  if (contentLength > config.demo.maxUploadBytes) throw new HttpError(413, `Uploads in the demo are limited to ${mb} MB at a time.`);
  const files = await prisma.media.count({ where: { event: { ownerId: user!.id } } });
  if (files >= config.demo.maxFiles) throw new HttpError(403, `The demo is limited to ${config.demo.maxFiles} files. Delete some to upload more.`);
}

export function assertNotDemo(what: string) {
  if (isDemo()) throw new HttpError(403, `${what} isn’t available in the demo.`);
}

// ---- Clean-up ----------------------------------------------------------------------

async function removeDemo(userId: string) {
  const events = await prisma.event.findMany({ where: { ownerId: userId }, select: { id: true } });
  for (const e of events) await removeEvent(e.id);
  await prisma.user.delete({ where: { id: userId } });
}

export async function removeExpiredDemos() {
  const cutoff = new Date(Date.now() - config.demo.minutes * 60_000);
  const expired = await prisma.user.findMany({ where: { plan: DEMO_PLAN, createdAt: { lt: cutoff } }, select: { id: true } });
  for (const u of expired) {
    try {
      await removeDemo(u.id);
    } catch (err) {
      logger.warn('Could not remove an expired demo:', err);
    }
  }
  if (expired.length) logger.info(`Removed ${expired.length} expired demo account(s).`);
}

export function scheduleDemoCleanup() {
  const run = () => void removeExpiredDemos().catch((err) => logger.warn('Demo clean-up failed:', err));
  run();
  setInterval(run, 2 * 60_000).unref();
}
