import fs from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { copyEvent } from '../src/services/eventCopy';
import { createDemoEvent } from '../src/services/demoSeed';
import { removeEvent } from '../src/services/eventRemoval';
import { resolveStoragePath } from '../src/services/mediaStorage';
import { stopAll } from '../src/services/timerService';

afterAll(async () => {
  stopAll();
  await prisma.$disconnect();
});

describe('copying an event', () => {
  it('makes a complete, independent copy for another owner', async () => {
    const owner = await prisma.user.create({ data: { authId: 'test:owner', email: 'owner@example.com' } });
    const guest = await prisma.user.create({ data: { authId: 'test:guest', email: 'guest@example.com' } });
    const sourceId = await createDemoEvent(owner.id);

    // Things only a real event has: a custom screen, a script, Quick Selection pointing at them.
    const custom = await prisma.screen.create({ data: { eventId: sourceId, title: 'Photo time', style: 'custom', position: 99 } });
    const first = await prisma.queueItem.findFirstOrThrow({ where: { eventId: sourceId }, orderBy: { position: 'asc' } });
    await prisma.queueItem.update({ where: { id: first.id }, data: { script: 'Good morning everyone…' } });
    const logo = (await prisma.event.findUniqueOrThrow({ where: { id: sourceId } })).logoMediaId!;
    await prisma.event.update({
      where: { id: sourceId },
      data: { preferences: JSON.stringify({ quickSelection: [{ screenId: custom.id }, { mediaId: logo }] }) },
    });

    const copyId = await copyEvent(sourceId, guest.id);
    const [src, copy] = await Promise.all(
      [sourceId, copyId].map((id) =>
        prisma.event.findUniqueOrThrow({
          where: { id },
          include: { media: true, screens: true, queueItems: { orderBy: { position: 'asc' } }, scheduleItems: true, displayState: true, timerState: true },
        }),
      ),
    );

    // Everything came along…
    expect(copy.ownerId).toBe(guest.id);
    expect(copy.name).toBe(src.name);
    expect(copy.media.map((m) => m.name).sort()).toEqual(src.media.map((m) => m.name).sort());
    expect(copy.queueItems.map((q) => q.title)).toEqual(src.queueItems.map((q) => q.title));
    expect(copy.queueItems[0].script).toBe('Good morning everyone…');
    expect(copy.screens.map((s) => s.title).sort()).toEqual(src.screens.map((s) => s.title).sort());
    expect(copy.scheduleItems).toHaveLength(src.scheduleItems.length);
    expect(copy.displayState?.mode).toBe('screen');

    // …and points only at the copy's own things.
    const copyMedia = new Set(copy.media.map((m) => m.id));
    const copyScreens = new Set(copy.screens.map((s) => s.id));
    expect(copyMedia.has(copy.logoMediaId!)).toBe(true);
    for (const q of copy.queueItems) {
      if (q.mediaId) expect(copyMedia.has(q.mediaId)).toBe(true);
      if (q.screenId) expect(copyScreens.has(q.screenId)).toBe(true);
    }
    const quick = JSON.parse(copy.preferences).quickSelection;
    expect(copyScreens.has(quick[0].screenId)).toBe(true);
    expect(copyMedia.has(quick[1].mediaId)).toBe(true);
    for (const m of src.media) expect(copy.preferences).not.toContain(m.id);

    // Files are real copies: removing the original leaves the copy intact.
    for (const m of copy.media) expect(fs.existsSync(resolveStoragePath(m.storagePath))).toBe(true);
    await removeEvent(sourceId);
    for (const m of copy.media) expect(fs.existsSync(resolveStoragePath(m.storagePath))).toBe(true);
    expect(await prisma.queueItem.count({ where: { eventId: copyId } })).toBe(src.queueItems.length);
  });
});
