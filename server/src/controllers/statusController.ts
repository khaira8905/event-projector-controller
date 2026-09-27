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
    disk: await diskSpace(),
  });
}

/**
 * Daily keep-alive (see .github/workflows/keep-alive.yml). Supabase pauses a free project
 * after a week without activity; a database query plus a request to its API each day keeps it
 * active. Public, cheap and says nothing about the data.
 */
export async function keepAlive(_req: Request, res: Response) {
  let database = false;
  let supabase: boolean | null = null;
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    database = true;
  } catch (err) {
    logger.warn('Keep-alive: database query failed.', err);
  }
  const { url, anonKey, serviceKey } = config.supabase;
  const key = anonKey || serviceKey;
  if (url && key) {
    try {
      supabase = (await fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, signal: AbortSignal.timeout(10_000) })).ok;
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
