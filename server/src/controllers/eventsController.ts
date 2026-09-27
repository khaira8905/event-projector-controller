import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { currentUser, ownedEvents } from '../services/accounts';
import { checkDemoEventLimit } from '../services/demoAccounts';
import { badRequest, notFound } from '../lib/errors';
import { logger } from '../lib/logger';
import { toEventDto } from '../lib/dto';
import { eventDate, idParam, trimmed } from '../lib/validation';
import { removeEvent } from '../services/eventRemoval';
import * as display from '../services/displayService';
import { emitToEvent } from '../socket/bus';
import { OVERLAY_POSITIONS } from '../services/controlService';
import { ensureBuiltinScreens } from '../services/screenService';
import { mergePreferences, parsePreferences, preferencesPatchSchema } from '../services/preferences';

const createSchema = z.object({
  name: trimmed(120).min(1, 'Event name is required'),
  date: eventDate,
  description: trimmed(2000).optional().default(''),
  venue: trimmed(200).optional().default(''),
  waitingMessage: trimmed(200).optional(),
});

const updateSchema = z.object({
  name: trimmed(120).min(1, 'Event name is required').optional(),
  date: eventDate.optional(),
  description: trimmed(2000).optional(),
  venue: trimmed(200).optional(),
  waitingMessage: trimmed(200).min(1).optional(),
  logoMediaId: idParam.nullable().optional(),
  overlayMediaId: idParam.nullable().optional(),
  overlayPosition: z.enum(OVERLAY_POSITIONS).optional(),
  overlaySize: z.number().int().min(2).max(60).optional(),
  overlayOpacity: z.number().int().min(0).max(100).optional(),
  overlayVisible: z.boolean().optional(),
  preferences: preferencesPatchSchema.optional(),
});

const withCounts = { _count: { select: { media: true, queueItems: true, scheduleItems: true } } } as const;

/** The event, if the current user may run it (someone else's event is simply "not found"). */
export async function findEventOr404(id: string) {
  const event = await prisma.event.findFirst({ where: { id: idParam.parse(id), ...ownedEvents() } });
  if (!event) throw notFound('Event not found.');
  return event;
}

export async function listEvents(_req: Request, res: Response) {
  const events = await prisma.event.findMany({ where: ownedEvents(), orderBy: [{ date: 'asc' }, { createdAt: 'asc' }], include: withCounts });
  res.json(events.map(toEventDto));
}

export async function getEvent(req: Request<{ id: string }>, res: Response) {
  await findEventOr404(req.params.id);
  const event = await prisma.event.findUniqueOrThrow({ where: { id: req.params.id }, include: withCounts });
  res.json(toEventDto(event));
}

export async function createEvent(req: Request, res: Response) {
  const body = createSchema.parse(req.body);
  await checkDemoEventLimit();
  const event = await prisma.event.create({
    data: {
      ...body,
      ownerId: currentUser()?.id ?? null,
      waitingMessage: body.waitingMessage || undefined,
      timerState: { create: {} },
      displayState: { create: {} },
    },
    include: withCounts,
  });
  await ensureBuiltinScreens(event.id);
  logger.info(`Created event "${event.name}" (${event.id})`);
  res.status(201).json(toEventDto(event));
}

export async function updateEvent(req: Request<{ id: string }>, res: Response) {
  const existing = await findEventOr404(req.params.id);
  const body = updateSchema.parse(req.body);
  if (body.logoMediaId) {
    const media = await prisma.media.findFirst({ where: { id: body.logoMediaId, eventId: existing.id } });
    if (!media) throw badRequest('Logo must be one of this event’s media files.');
    if (media.kind !== 'image') throw badRequest('The event logo must be an image.');
  }
  if (body.overlayMediaId) {
    const media = await prisma.media.findFirst({ where: { id: body.overlayMediaId, eventId: existing.id } });
    if (!media || media.kind !== 'image') throw badRequest('The overlay logo must be an image from this event.');
  }
  const { preferences: prefsPatch, ...fields } = body;
  const data: typeof fields & { preferences?: string } = { ...fields };
  if (prefsPatch) {
    // Merge into what is stored, so one screen can change Quick Selection without touching the rest.
    data.preferences = JSON.stringify(mergePreferences(parsePreferences(existing.preferences), prefsPatch));
  }
  const event = await prisma.event.update({ where: { id: existing.id }, data, include: withCounts });
  const dto = toEventDto(event);
  emitToEvent(event.id, 'event:changed', dto);
  await display.refresh(event.id);
  res.json(dto);
}

export async function deleteEvent(req: Request<{ id: string }>, res: Response) {
  const event = await findEventOr404(req.params.id);
  await removeEvent(event.id);
  logger.info(`Deleted event "${event.name}" (${event.id})`);
  res.status(204).end();
}
