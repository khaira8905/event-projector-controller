import fs from 'node:fs';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { emitToOperators } from '../socket/bus';
import { resolveStoragePath } from './mediaStorage';
import { cloudStorage } from './storage';

/**
 * Copies uploaded files to cloud storage in the background, so uploads feel
 * instant and a flaky venue connection never blocks the operator. Failed
 * uploads are retried with backoff and again on the next server start.
 */
const queue: string[] = [];
const retries = new Map<string, number>();
let running = false;

let lastHealth: { ok: boolean; message: string; checkedAt: number } | null = null;

export function enqueueCloudUpload(mediaId: string) {
  if (!cloudStorage()) return;
  if (!queue.includes(mediaId)) queue.push(mediaId);
  void run();
}

async function run() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      await uploadOne(id);
    }
  } finally {
    running = false;
  }
}

async function uploadOne(mediaId: string) {
  const store = cloudStorage();
  if (!store) return;
  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) return;
  try {
    await prisma.media.updateMany({ where: { id: mediaId }, data: { cloudStatus: 'pending', cloudError: null } });
    await store.upload(media.storagePath, resolveStoragePath(media.storagePath), media.mimeType);
    if (media.renderPath && fs.existsSync(resolveStoragePath(media.renderPath))) {
      await store.upload(media.renderPath, resolveStoragePath(media.renderPath), 'application/pdf');
    }
    await prisma.media.updateMany({ where: { id: mediaId }, data: { cloudStatus: 'synced', cloudError: null } });
    retries.delete(mediaId);
    logger.info(`Uploaded "${media.name}" to cloud storage.`);
  } catch (err: any) {
    const attempt = (retries.get(mediaId) ?? 0) + 1;
    retries.set(mediaId, attempt);
    logger.warn(`Cloud upload of "${media.name}" failed (attempt ${attempt}):`, err?.message ?? err);
    await prisma.media
      .update({ where: { id: mediaId }, data: { cloudStatus: 'error', cloudError: 'Cloud upload failed. Retrying…' } })
      .catch(() => {});
    if (attempt < 6) {
      const delay = Math.min(60_000, 2000 * 2 ** attempt);
      setTimeout(() => enqueueCloudUpload(mediaId), delay).unref();
    }
  }
  emitToOperators(media.eventId, 'media:changed', { eventId: media.eventId });
}

/**
 * Makes sure a file exists locally, restoring it from the cloud copy if the local
 * one is gone (e.g. uploads folder cleaned, or a fresh install with the same database).
 */
export async function ensureLocalCopy(relativePath: string): Promise<boolean> {
  const abs = resolveStoragePath(relativePath);
  if (fs.existsSync(abs)) return true;
  const store = cloudStorage();
  if (!store) return false;
  try {
    await store.download(relativePath, abs);
    logger.info(`Restored ${relativePath} from cloud storage.`);
    return true;
  } catch (err: any) {
    logger.warn(`Could not restore ${relativePath} from cloud:`, err?.message ?? err);
    return false;
  }
}

export async function removeFromCloud(paths: (string | null | undefined)[]) {
  const store = cloudStorage();
  const keys = paths.filter((p): p is string => !!p);
  if (!store || keys.length === 0) return;
  try {
    await store.remove(keys);
  } catch (err: any) {
    logger.warn('Could not delete files from cloud storage:', err?.message ?? err);
  }
}

/** Re-queues files that never made it to the cloud (e.g. the app was closed mid-upload). */
export async function resumePendingUploads() {
  if (!cloudStorage()) return;
  const pending = await prisma.media.findMany({ where: { cloudStatus: { in: ['local', 'pending', 'error'] } }, select: { id: true } });
  pending.forEach((m) => enqueueCloudUpload(m.id));
  if (pending.length) logger.info(`Queued ${pending.length} file(s) for cloud upload.`);
}

export async function cloudStatus() {
  const store = cloudStorage();
  const counts = await prisma.media.groupBy({ by: ['cloudStatus'], _count: true });
  const byStatus = Object.fromEntries(counts.map((c) => [c.cloudStatus, c._count]));
  if (!store) return { provider: 'local', ok: true, message: 'Files are stored on this computer only.', pending: 0, errors: 0 };
  if (!lastHealth || Date.now() - lastHealth.checkedAt > 15_000) {
    lastHealth = { ...(await store.health()), checkedAt: Date.now() };
  }
  return {
    provider: store.name,
    ok: lastHealth.ok,
    message: lastHealth.message,
    pending: (byStatus.local ?? 0) + (byStatus.pending ?? 0),
    errors: byStatus.error ?? 0,
  };
}
