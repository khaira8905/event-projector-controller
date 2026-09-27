import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { emitToEvent } from '../socket/bus';
import { removeFromCloud } from './cloudSync';
import * as display from './displayService';
import { removeEventUploads } from './mediaStorage';
import { forgetScreens } from './screenService';
import * as timer from './timerService';

/** Deletes an event with everything in it: rows, live state, local files and cloud copies. */
export async function removeEvent(eventId: string) {
  const media = await prisma.media.findMany({ where: { eventId }, select: { storagePath: true, renderPath: true } });
  await prisma.event.delete({ where: { id: eventId } });
  timer.forget(eventId);
  display.forget(eventId);
  forgetScreens(eventId);
  emitToEvent(eventId, 'event:deleted', { eventId });
  try {
    await removeEventUploads(eventId);
  } catch (err) {
    logger.warn('Could not remove uploads for deleted event', eventId, err);
  }
  void removeFromCloud(media.flatMap((m) => [m.storagePath, m.renderPath]));
}
