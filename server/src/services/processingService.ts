import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { emitToOperators } from '../socket/bus';
import { resolveStoragePath } from './mediaStorage';
import { enqueueCloudUpload, ensureLocalCopy } from './cloudSync';
import * as display from './displayService';

/**
 * File processing, isolated from the request path:
 *  - PDFs: count pages.
 *  - PPT/PPTX: convert to PDF with LibreOffice (headless), keeping the original file.
 *    The PDF is what the display renders, which gives real slide-by-slide control
 *    while preserving the deck's appearance as closely as LibreOffice can.
 */

export async function countPdfPages(absPath: string): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(await fsp.readFile(absPath), { ignoreEncryption: true, updateMetadata: false });
    return doc.getPageCount();
  } catch (err: any) {
    logger.warn(`Could not read page count of ${path.basename(absPath)}:`, err?.message ?? err);
    return null;
  }
}

// ---- LibreOffice detection -------------------------------------------------------

let sofficeCache: string | null | undefined;

const CANDIDATES = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
  '/opt/homebrew/bin/soffice',
  '/snap/bin/libreoffice',
];

function onPath(binary: string): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.com', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const ext of exts) {
      const candidate = path.join(dir, binary + ext);
      if (dir && fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function findSoffice(): string | null {
  if (sofficeCache !== undefined) return sofficeCache;
  if (config.sofficePath) sofficeCache = fs.existsSync(config.sofficePath) ? config.sofficePath : null;
  else sofficeCache = onPath('soffice') ?? CANDIDATES.find((c) => fs.existsSync(c)) ?? null;
  return sofficeCache;
}

export function resetSofficeCache() {
  sofficeCache = undefined;
}

// ---- Conversion queue ------------------------------------------------------------

const queue: string[] = [];
let running = false;
let current: string | null = null;

export function enqueueConversion(mediaId: string) {
  if (!queue.includes(mediaId) && current !== mediaId) queue.push(mediaId);
  void run();
}

async function run() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      current = queue.shift()!;
      await convertOne(current);
    }
  } finally {
    current = null;
    running = false;
  }
}

function execSoffice(soffice: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(soffice, args, { timeout: config.conversionTimeoutMs, windowsHide: true }, (err, _stdout, stderr) => {
      if (err) reject(new Error(err.killed ? 'Conversion timed out.' : stderr?.toString().trim() || err.message));
      else resolve();
    });
  });
}

/** Saves progress on a file. It may have been deleted meanwhile (with its event, or a demo that ended). */
async function update(mediaId: string, eventId: string, data: Parameters<typeof prisma.media.update>[0]['data']) {
  const { count } = await prisma.media.updateMany({ where: { id: mediaId }, data });
  if (count) emitToOperators(eventId, 'media:changed', { eventId });
}

async function convertOne(mediaId: string) {
  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media || media.kind !== 'presentation') return;

  const soffice = findSoffice();
  if (!soffice) {
    await update(mediaId, media.eventId, {
      conversionStatus: 'unavailable',
      conversionError: 'Install LibreOffice to show PowerPoint slides here, or upload a PDF export.',
    });
    return;
  }

  if (!(await ensureLocalCopy(media.storagePath))) {
    logger.warn(`Cannot convert "${media.name}": the file is missing.`);
    await update(mediaId, media.eventId, { conversionStatus: 'failed', conversionError: 'The original file is missing. Upload it again.' });
    return;
  }
  await update(mediaId, media.eventId, { conversionStatus: 'pending', conversionError: null });
  const started = Date.now();
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ec-convert-'));
  try {
    // A private profile avoids clashing with a LibreOffice window the operator has open.
    const profile = pathToFileURL(path.join(work, 'profile')).href;
    const input = path.join(work, `input${path.extname(media.storagePath).toLowerCase()}`);
    await fsp.copyFile(resolveStoragePath(media.storagePath), input);
    await execSoffice(soffice, [
      `-env:UserInstallation=${profile}`,
      '--headless',
      '--norestore',
      '--nolockcheck',
      '--convert-to',
      'pdf',
      '--outdir',
      work,
      input,
    ]);
    const output = path.join(work, 'input.pdf');
    if (!fs.existsSync(output)) throw new Error('LibreOffice did not produce a PDF.');

    // Stored next to the original: uploads/<event>/presentations/<file>.slides.pdf
    const renderPath = `${media.storagePath}.slides.pdf`;
    const dest = resolveStoragePath(renderPath);
    await fsp.copyFile(output, dest);
    const pageCount = await countPdfPages(dest);
    await update(mediaId, media.eventId, { renderPath, pageCount, conversionStatus: 'ready', conversionError: null });
    logger.info(`Converted "${media.name}" to ${pageCount ?? '?'} slides in ${Date.now() - started} ms.`);
    enqueueCloudUpload(mediaId);
    await display.refresh(media.eventId);
  } catch (err: any) {
    logger.error(`Conversion of "${media.name}" failed:`, err?.message ?? err);
    await update(mediaId, media.eventId, {
      conversionStatus: 'failed',
      conversionError: 'Could not convert this presentation. Try exporting it as PDF from PowerPoint.',
    });
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/** Runs the right processing for a freshly stored file. */
export async function processNewMedia(mediaId: string) {
  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) return;
  if (media.kind === 'pdf') {
    if (!(await ensureLocalCopy(media.storagePath))) return;
    const pageCount = await countPdfPages(resolveStoragePath(media.storagePath));
    await prisma.media.updateMany({ where: { id: mediaId }, data: { pageCount, conversionStatus: 'none' } });
  } else if (media.kind === 'presentation') {
    await prisma.media.updateMany({ where: { id: mediaId }, data: { conversionStatus: 'pending' } });
    enqueueConversion(mediaId);
  }
}

/** Picks up conversions interrupted by a restart and presentations uploaded before LibreOffice was installed. */
export async function resumeProcessing() {
  const todo = await prisma.media.findMany({
    where: {
      OR: [
        { kind: 'presentation', conversionStatus: { in: ['none', 'pending', 'unavailable'] } },
        { kind: 'pdf', pageCount: null },
      ],
    },
    select: { id: true, kind: true, conversionStatus: true },
  });
  for (const m of todo) {
    if (m.kind === 'pdf') await processNewMedia(m.id);
    // Retry "unavailable" ones only once LibreOffice has been installed.
    else if (findSoffice() || m.conversionStatus !== 'unavailable') enqueueConversion(m.id);
  }
}

export function conversionStatus() {
  const soffice = findSoffice();
  return { available: !!soffice, queued: queue.length + (running ? 1 : 0) };
}
