import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { enqueueCloudUpload, ensureLocalCopy } from './cloudSync';
import { resolveStoragePath, storeFile } from './mediaStorage';
import { processNewMedia } from './processingService';
import { ensureBuiltinScreens } from './screenService';

/**
 * A complete, independent copy of an event for another owner: details, branding, files
 * (with their converted slides), screens, Show Flow with notes and scripts, schedule, timer
 * settings and event preferences. Nothing is shared with the original: files are copied,
 * and every id the copy refers to (Quick Selection, logo, backgrounds) points at the copy's
 * own items. Used for the public demo's showcase event. Returns the new event id.
 */
export async function copyEvent(sourceId: string, ownerId: string): Promise<string> {
  const src = await prisma.event.findUnique({
    where: { id: sourceId },
    include: { media: true, screens: true, queueItems: { orderBy: { position: 'asc' } }, scheduleItems: true, timerState: true },
  });
  if (!src) throw new Error('The event to copy no longer exists.');

  const event = await prisma.event.create({
    data: {
      ownerId,
      name: src.name,
      date: src.date,
      description: src.description,
      venue: src.venue,
      waitingMessage: src.waitingMessage,
      overlayPosition: src.overlayPosition,
      overlaySize: src.overlaySize,
      overlayOpacity: src.overlayOpacity,
      overlayVisible: src.overlayVisible,
      // A fresh show: timer settings kept, nothing running; the projector starts on a screen.
      timerState: {
        create: {
          durationMs: src.timerState?.durationMs ?? 600_000,
          remainingMs: src.timerState?.durationMs ?? 600_000,
          warningMs: src.timerState?.warningMs ?? 120_000,
          showOnDisplay: src.timerState?.showOnDisplay ?? false,
        },
      },
      displayState: { create: { mode: 'screen' } },
    },
  });

  // Old id → new id, for everything the copy refers to.
  const ids = new Map<string, string>();

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'eventcontrol-copy-'));
  try {
    for (const m of src.media) {
      if (!(await ensureLocalCopy(m.storagePath))) {
        logger.warn(`Copying "${src.name}": file "${m.name}" is missing, left out.`);
        continue;
      }
      // storeFile moves its input, so hand it a copy of the original.
      const tmp = path.join(tmpDir, `${m.id}-${path.basename(m.storagePath)}`);
      await fsp.copyFile(resolveStoragePath(m.storagePath), tmp);
      const storagePath = await storeFile(tmp, event.id, m.originalName);
      let renderPath: string | null = null;
      if (m.renderPath && (await ensureLocalCopy(m.renderPath))) {
        renderPath = `${storagePath}.slides.pdf`;
        await fsp.copyFile(resolveStoragePath(m.renderPath), resolveStoragePath(renderPath));
      }
      const copy = await prisma.media.create({
        data: {
          eventId: event.id,
          name: m.name,
          originalName: m.originalName,
          storagePath,
          kind: m.kind,
          mimeType: m.mimeType,
          size: m.size,
          hash: m.hash,
          folder: m.folder,
          pageCount: m.pageCount,
          renderPath,
          // Converted slides come along; a presentation without them is converted again below.
          conversionStatus: renderPath ? 'ready' : m.kind === 'presentation' ? 'none' : m.conversionStatus,
          conversionError: renderPath ? null : m.conversionError,
          source: m.source,
          sourceRef: m.sourceRef,
        },
      });
      ids.set(m.id, copy.id);
      if (m.kind === 'presentation' && !renderPath) await processNewMedia(copy.id);
      enqueueCloudUpload(copy.id);
    }
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }

  for (const s of src.screens) {
    const copy = await prisma.screen.create({
      data: {
        eventId: event.id,
        key: s.key,
        title: s.title,
        subtitle: s.subtitle,
        style: s.style,
        backgroundMediaId: s.backgroundMediaId ? (ids.get(s.backgroundMediaId) ?? null) : null,
        showTimer: s.showTimer,
        position: s.position,
      },
    });
    ids.set(s.id, copy.id);
  }

  let position = 0;
  for (const q of src.queueItems) {
    const mediaId = q.mediaId ? ids.get(q.mediaId) : undefined;
    const screenId = q.screenId ? ids.get(q.screenId) : undefined;
    if (!mediaId && !screenId) continue; // its file was missing
    await prisma.queueItem.create({
      data: {
        eventId: event.id,
        kind: q.kind,
        mediaId: mediaId ?? null,
        screenId: screenId ?? null,
        startPage: q.startPage,
        endPage: q.endPage,
        position: position++,
        title: q.title,
        durationSeconds: q.durationSeconds,
        notes: q.notes,
        script: q.script,
      },
    });
  }

  if (src.scheduleItems.length) {
    await prisma.scheduleItem.createMany({
      data: src.scheduleItems.map((i) => ({ eventId: event.id, time: i.time, title: i.title, description: i.description, durationMinutes: i.durationMinutes })),
    });
  }

  // Preferences (Quick Selection…) name screens and files by id: point them at the copies.
  // Ids are unique random strings, so replacing them in the JSON can't touch anything else.
  let preferences = src.preferences;
  for (const [from, to] of ids) preferences = preferences.split(from).join(to);
  await prisma.event.update({
    where: { id: event.id },
    data: {
      preferences,
      logoMediaId: src.logoMediaId ? (ids.get(src.logoMediaId) ?? null) : null,
      overlayMediaId: src.overlayMediaId ? (ids.get(src.overlayMediaId) ?? null) : null,
    },
  });
  await ensureBuiltinScreens(event.id);
  return event.id;
}
