import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { getFileType, hashFile, resolveStoragePath, storedFileExists, storeFile } from './mediaStorage';
import { enqueueCloudUpload } from './cloudSync';
import { processNewMedia } from './processingService';
import { ensureBuiltinScreens, findScreenByKey } from './screenService';

/** A Show Flow entry: a demo file (optionally a slide range) or a built-in screen. */
type DemoItem =
  | { file: string; title?: string; notes?: string; durationSeconds?: number; startPage?: number; endPage?: number }
  | { screen: string; title?: string; notes?: string; durationSeconds?: number };

const FOLDERS: Record<string, string> = {
  'Welcome.png': 'Event Branding',
  'ACM Introduction.pptx': 'Main Presentation',
  'Speaker Presentation.pdf': 'Speaker 1',
  'Break.webm': 'Break Screens',
  'Closing.png': 'Event Branding',
  'ACM Logo.png': 'Logos',
};

const FLOW: DemoItem[] = [
  { screen: 'starting', notes: 'Doors open. Start the 5:00 countdown when the MC is ready.', durationSeconds: 300 },
  { file: 'Welcome.png', title: 'Welcome Screen', notes: 'Hold on this until the auditorium is seated. Cue the MC.' },
  {
    file: 'ACM Introduction.pptx',
    title: 'ACM Introduction',
    notes: 'Introduce the ACM student chapter before slide 3.',
    durationSeconds: 600,
  },
  { screen: 'please-wait', notes: 'Speaker is setting up the microphone.', durationSeconds: 30 },
  {
    file: 'Speaker Presentation.pdf',
    title: 'Guest Speaker — Building for the Web',
    notes: 'Speaker asked for a 2-minute warning. Start the 20:00 timer when they begin.',
    durationSeconds: 1200,
  },
  { screen: 'break', notes: '10-minute break. Lights up.', durationSeconds: 600 },
  { file: 'Break.webm', title: 'Break Video', notes: 'Plays during the break.' },
  { file: 'Closing.png', title: 'Closing & Thank You', notes: 'Thank sponsors and volunteers. Announce the group photo.' },
  { screen: 'thanks' },
];

const SCHEDULE = [
  { time: '10:00', title: 'Opening', description: 'Doors open, welcome screen' },
  { time: '10:05', title: 'Welcome Address', description: 'MC opens the event' },
  { time: '10:15', title: 'ACM Introduction', description: 'Chapter chair' },
  { time: '10:30', title: 'Guest Presentation', description: 'Building for the Web' },
  { time: '10:50', title: 'Break', description: 'Refreshments in the lobby' },
  { time: '11:00', title: 'Technical Session', description: 'Hands-on workshop' },
  { time: '12:00', title: 'Closing Ceremony', description: 'Prizes and group photo' },
];

/** Creates demo events the first time the app starts, so it is demonstrable immediately. */
export async function seedDemoIfEmpty() {
  const count = await prisma.event.count();
  if (count > 0) return;

  logger.info('Empty database: creating demo events…');
  await createDemoEvent(null);

  const recruitment = await prisma.event.create({
    data: {
      name: 'ACM Recruitment 2026',
      date: new Date('2026-10-05T00:00:00.000Z'),
      venue: 'Seminar Hall B',
      description: 'Orientation and recruitment drive for new chapter members.',
      timerState: { create: {} },
      displayState: { create: {} },
    },
  });
  await ensureBuiltinScreens(recruitment.id);
}

/**
 * The demo show — files, Show Flow, schedule, logo — as a new event owned by `ownerId`
 * (null: nobody, for the first-run seed). Used for the first run and for every "Try the demo"
 * visitor. Returns the event id.
 */
export async function createDemoEvent(ownerId: string | null): Promise<string> {
  const event = await prisma.event.create({
    data: {
      name: 'ACM Tech Fest 2026',
      date: new Date('2026-09-24T00:00:00.000Z'),
      venue: 'Main Auditorium',
      description: 'Annual technical festival of the ACM student chapter — talks, workshops and demos.',
      waitingMessage: 'The session will begin shortly',
      ownerId,
      timerState: { create: { durationMs: 10 * 60_000, remainingMs: 10 * 60_000, warningMs: 2 * 60_000 } },
      displayState: { create: { mode: 'screen' } },
      scheduleItems: { create: SCHEDULE },
    },
  });

  const files = Object.keys(FOLDERS);
  const mediaIds = new Map<string, string>();
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'eventcontrol-demo-'));
  try {
    for (const file of files) {
      const source = path.join(config.demoAssetsDir, file);
      const type = getFileType(file);
      if (!type || !fs.existsSync(source)) {
        logger.warn(`Demo asset missing, skipping: ${file}`);
        continue;
      }
      // storeFile moves its input, so work on a copy of the bundled asset.
      const copy = path.join(tmpDir, path.basename(file));
      await fsp.copyFile(source, copy);
      const [hash, stat] = await Promise.all([hashFile(copy), fsp.stat(copy)]);
      const storagePath = await storeFile(copy, event.id, file);
      const media = await prisma.media.create({
        data: {
          eventId: event.id,
          name: file,
          originalName: file,
          storagePath,
          kind: type.kind,
          mimeType: type.mimeType,
          size: stat.size,
          hash,
          folder: FOLDERS[file] ?? '',
        },
      });
      mediaIds.set(file, media.id);
      // The same presentation was converted before (another demo): reuse its slides instead
      // of running LibreOffice again. Otherwise page counts now, conversion in the background.
      if (!(await reuseConversion(media.id, hash, storagePath))) await processNewMedia(media.id);
      enqueueCloudUpload(media.id);
    }
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }

  await ensureBuiltinScreens(event.id);
  let position = 0;
  for (const item of FLOW) {
    if ('screen' in item) {
      const screen = await findScreenByKey(event.id, item.screen);
      if (!screen) continue;
      await prisma.queueItem.create({
        data: { eventId: event.id, kind: 'screen', screenId: screen.id, position: position++, notes: item.notes ?? '', durationSeconds: item.durationSeconds ?? null },
      });
      continue;
    }
    const mediaId = mediaIds.get(item.file);
    if (!mediaId) continue;
    await prisma.queueItem.create({
      data: {
        eventId: event.id,
        kind: 'media',
        mediaId,
        position: position++,
        title: item.title,
        notes: item.notes ?? '',
        durationSeconds: item.durationSeconds ?? null,
        startPage: item.startPage ?? null,
        endPage: item.endPage ?? null,
      },
    });
  }
  const logoId = mediaIds.get('ACM Logo.png');
  if (logoId) {
    await prisma.event.update({
      where: { id: event.id },
      data: { logoMediaId: logoId, overlayMediaId: logoId, overlayPosition: 'top-right', overlaySize: 8, overlayOpacity: 85, overlayVisible: false },
    });
  }

  logger.info(`Demo event "${event.name}" created with ${mediaIds.size} media files.`);
  return event.id;
}

/** Copies the slides of an already-converted identical presentation. True when it did. */
async function reuseConversion(mediaId: string, hash: string, storagePath: string): Promise<boolean> {
  const done = await prisma.media.findFirst({
    where: { hash, kind: 'presentation', conversionStatus: 'ready', renderPath: { not: null }, id: { not: mediaId } },
    orderBy: { createdAt: 'desc' },
  });
  if (!done?.renderPath || !storedFileExists(done.renderPath)) return false;
  const renderPath = `${storagePath}.slides.pdf`;
  await fsp.copyFile(resolveStoragePath(done.renderPath), resolveStoragePath(renderPath));
  await prisma.media.update({ where: { id: mediaId }, data: { renderPath, pageCount: done.pageCount, conversionStatus: 'ready' } });
  return true;
}
