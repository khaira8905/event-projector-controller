import fs from 'node:fs/promises';
import type { Request, Response } from 'express';
import { config } from '../config';
import { isLocalRequest } from '../lib/network';
import { cloudStatus } from '../services/cloudSync';
import { conversionStatus } from '../services/processingService';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/** Health of the pieces the operator depends on: cloud storage and PowerPoint conversion. */
export async function getStatus(req: Request, res: Response) {
  res.json({
    server: { ok: true, time: Date.now() },
    storage: await cloudStatus(),
    conversion: conversionStatus(),
    auth: { provider: config.auth.provider },
    // "Open in PowerPoint" launches the app on the server's screen: only offered to a browser on that machine.
    openExternally: config.allowExternalOpen && isLocalRequest(req),
    // The server's free space means something on your own computer, not on a hosted server
    // shared through accounts.
    disk: config.auth.provider === 'supabase' ? null : await diskSpace(),
  });
}

/**
 * Daily keep-alive (see .github/workflows/keep-alive.yml). Supabase pauses a free project
 * after a week of low activity, and a bare `SELECT 1` wasn't enough: the project was paused
 * in October 2026 while that ran every day. So each ping now does real work: it writes the
 * time of the ping to a table, reads a real table, and calls Supabase's Auth and Data APIs.
 * Public, cheap and says nothing about the data.
 */
export async function keepAlive(_req: Request, res: Response) {
  let database = false;
  let supabase: boolean | null = null;
  try {
    const time = new Date().toISOString();
    await prisma.setting.upsert({ where: { key: 'keepAlive.lastPing' }, create: { key: 'keepAlive.lastPing', value: time }, update: { value: time } });
    await prisma.user.count();
    database = true;
  } catch (err) {
    logger.warn('Keep-alive: database query failed.', err);
  }
  const { url, anonKey, serviceKey } = config.supabase;
  const key = anonKey || serviceKey;
  if (url && key) {
    try {
      const call = (path: string) => fetch(`${url}${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
      const [auth, data] = await Promise.all([call('/auth/v1/health'), call('/rest/v1/')]);
      // The Data API may be switched off for this project (EventControl doesn't need it): only Auth decides.
      supabase = auth.ok;
      if (!data.ok) logger.info(`Keep-alive: Supabase Data API answered ${data.status}.`);
    } catch {
      supabase = false;
    }
  }
  res.status(database && supabase !== false ? 200 : 503).json({ ok: database && supabase !== false, database, supabase, time: Date.now() });
}

/** Free space on the drive that holds the uploads, for the operator's storage meter. */
async function diskSpace(): Promise<{ free: number; total: number } | null> {
  try {
    const s = await fs.statfs(config.uploadsDir);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return null;
  }
}
