import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/errors';
import { logger } from '../lib/logger';
import { config } from '../config';
import { controlCommandSchema, execute } from '../services/controlService';
import * as display from '../services/displayService';
import * as timer from '../services/timerService';
import { emitToOperators, rooms, setIo } from './bus';
import { parseCookies } from '../lib/cookies';
import { allowedOrigin } from '../lib/network';
import { SESSION_COOKIE, authEnabled, verifySessionToken } from '../services/authService';
import { userFromSubject } from '../services/accounts';

type Role = 'operator' | 'display';
type Ack = (response: { ok: true; data?: unknown } | { ok: false; error: string; status?: number }) => void;

const joinSchema = z.object({
  eventId: z.string().min(1).max(64),
  role: z.enum(['operator', 'display']),
});

/** Counts connected displays/operators per event so the dashboard can show LIVE / OFFLINE. */
export async function presenceFor(io: Server, eventId: string) {
  const [displays, operators] = await Promise.all([
    io.in(rooms.displays(eventId)).fetchSockets(),
    io.in(rooms.operators(eventId)).fetchSockets(),
  ]);
  return { displays: displays.length, operators: operators.length };
}

async function broadcastPresence(io: Server, eventId: string) {
  emitToOperators(eventId, 'presence:update', { eventId, ...(await presenceFor(io, eventId)) });
}

function errorMessage(err: unknown): string {
  if (err instanceof HttpError) return err.message;
  if (err instanceof z.ZodError) return 'Invalid command.';
  logger.error('Socket command failed:', err);
  return 'Something went wrong on the server.';
}

function safeAck(ack: unknown): Ack {
  return typeof ack === 'function' ? (ack as Ack) : () => {};
}

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    // Fast detection of a dropped projector connection.
    pingInterval: 5000,
    pingTimeout: 5000,
    // Clients that briefly drop keep their rooms and missed events.
    connectionStateRecovery: { maxDisconnectionDuration: 30_000 },
    // Same-site pages always work; a separately hosted UI must be listed in PUBLIC_APP_URL / CORS_ORIGINS.
    cors: { origin: [...config.corsOrigins], credentials: true },
    // Private mode: another website must not drive the show with a signed-in operator's cookie.
    // (With open access anyone with the link may control it, so there is nothing to protect.)
    allowRequest: (req, cb) =>
      cb(null, !authEnabled() || allowedOrigin(req.headers.origin, (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0].trim() ?? req.headers.host)),
  });
  setIo(io);

  io.on('connection', (socket: Socket) => {
    /**
     * A client announces which event it belongs to and in which role. The reply
     * is a full state snapshot, which is how a refreshed or reconnected display
     * restores exactly what it should be showing.
     */
    socket.on('event:join', async (payload: unknown, rawAck: unknown) => {
      const ack = safeAck(rawAck);
      try {
        const { eventId, role } = joinSchema.parse(payload);
        const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, ownerId: true } });
        if (!event) throw new HttpError(404, 'Event not found.');

        // Displays may join freely (read-only); controlling an event requires being signed in
        // as its owner. Someone else's event looks exactly like a missing one.
        if (role === 'operator' && authEnabled()) {
          const session = await verifySessionToken(parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE]);
          const user = session ? await userFromSubject(session.subject) : null;
          if (!user) throw new HttpError(401, 'Please sign in.');
          if (event.ownerId !== user.id) throw new HttpError(404, 'Event not found.');
        }

        const previous = socket.data.eventId as string | undefined;
        if (previous) {
          for (const room of [rooms.all(previous), rooms.operators(previous), rooms.displays(previous)]) socket.leave(room);
          if (previous !== eventId) void broadcastPresence(io, previous);
        }
        socket.data.eventId = eventId;
        socket.data.role = role as Role;
        socket.join(rooms.all(eventId));
        socket.join(role === 'operator' ? rooms.operators(eventId) : rooms.displays(eventId));

        const [displayState, timerState, presence] = await Promise.all([
          display.getSnapshot(eventId),
          timer.getTimer(eventId),
          presenceFor(io, eventId),
        ]);
        ack({ ok: true, data: { display: displayState, timer: timerState, presence: { eventId, ...presence } } });
        void broadcastPresence(io, eventId);
        logger.info(`${role} joined event ${eventId} (${socket.id})`);
      } catch (err) {
        // The status tells the client whether retrying makes sense (404/401 won't fix themselves).
        ack({ ok: false, error: errorMessage(err), status: err instanceof HttpError ? err.status : 500 });
      }
    });

    /** Operator commands: NEXT, PREVIOUS, BLACK, WAITING, timer controls, ... */
    socket.on('control', async (payload: unknown, rawAck: unknown) => {
      const ack = safeAck(rawAck);
      try {
        const eventId = socket.data.eventId as string | undefined;
        if (!eventId || socket.data.role !== 'operator') {
          throw new HttpError(403, 'Join the event as an operator first.');
        }
        // An open console outlives its sign-in: re-check (cached) that the account still exists
        // and the session hasn't expired before carrying out anything.
        if (authEnabled()) {
          const session = await verifySessionToken(parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE]);
          if (!session || !(await userFromSubject(session.subject))) throw new HttpError(401, 'Please sign in.');
        }
        const command = controlCommandSchema.parse(payload);
        const data = await execute(eventId, command);
        ack({ ok: true, data });
      } catch (err) {
        ack({ ok: false, error: errorMessage(err), status: err instanceof HttpError ? err.status : undefined });
      }
    });

    /** Displays report back whether a fullscreen request succeeded. */
    socket.on('display:fullscreen-result', (payload: unknown) => {
      const eventId = socket.data.eventId as string | undefined;
      if (!eventId || socket.data.role !== 'display') return;
      const ok = z.object({ ok: z.boolean() }).safeParse(payload);
      if (ok.success) emitToOperators(eventId, 'display:fullscreen-result', ok.data);
    });

    /** Lets clients estimate the offset between their clock and the server's. */
    socket.on('clock:ping', (_payload: unknown, rawAck: unknown) => {
      safeAck(rawAck)({ ok: true, data: { serverNow: Date.now() } });
    });

    socket.on('disconnect', () => {
      const eventId = socket.data.eventId as string | undefined;
      if (eventId) void broadcastPresence(io, eventId);
    });
  });

  return io;
}
