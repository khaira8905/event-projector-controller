import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { createSocket, emitWithAck, type AckResponse } from '../services/socket';
import type { ControlCommand, DisplaySnapshot, Presence, TimerSnapshot } from '../types';

export interface EventSocketHandlers {
  onQueueChanged?: () => void;
  onMediaChanged?: () => void;
  onScheduleChanged?: () => void;
  onScreensChanged?: () => void;
  onEventChanged?: () => void;
  onEventDeleted?: () => void;
  onVideo?: (action: 'play' | 'pause' | 'restart') => void;
  onFullscreenRequest?: () => void;
  onFullscreenResult?: (ok: boolean) => void;
  /**
   * Called after a re-join (reconnect, server restart, tab coming back from sleep).
   * Anything learned from change notifications may be stale by then, so reload it.
   */
  onResync?: () => void;
}

interface JoinData {
  display: DisplaySnapshot;
  timer: TimerSnapshot;
  presence: Presence;
}

/**
 * Connects to the server, joins the event room in the given role and keeps the
 * authoritative display/timer state in React state. On every (re)connect the
 * client re-joins and receives a full snapshot, so a refreshed or briefly
 * disconnected projector restores exactly what it should be showing.
 *
 * Long pauses are the tricky case: a laptop lid closed, a tab put to sleep by the
 * browser, a server restart. Then:
 *  - a failed or timed-out join is retried with backoff; only "event not found"
 *    is treated as final, and an expired session sends the operator to sign in;
 *  - every re-join asks the page to reload its lists (onResync), because change
 *    notifications sent while we were away were never received;
 *  - when the tab becomes visible again we reconnect at once instead of waiting
 *    for the next backoff step, and re-sync the clock.
 */
export function useEventSocket(eventId: string | undefined, role: 'operator' | 'display', handlers: EventSocketHandlers = {}) {
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [display, setDisplay] = useState<DisplaySnapshot | null>(null);
  const [timer, setTimer] = useState<TimerSnapshot | null>(null);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const acceptDisplay = useCallback((next: DisplaySnapshot) => {
    // Ignore out-of-order snapshots.
    setDisplay((prev) => (prev && prev.eventId === next.eventId && prev.version > next.version ? prev : next));
  }, []);

  useEffect(() => {
    if (!eventId) return;
    const socket = createSocket();
    socketRef.current = socket;
    let disposed = false;
    let joinedOnce = false;
    let retry = 0;
    let retryTimer = 0;
    let hiddenAt = 0;

    const syncClock = async () => {
      const t0 = Date.now();
      const res = await emitWithAck<{ serverNow: number }>(socket, 'clock:ping', null);
      if (!disposed && res.ok && res.data) {
        const rtt = Date.now() - t0;
        setClockOffset(res.data.serverNow - (t0 + rtt / 2));
      }
    };

    const join = async () => {
      window.clearTimeout(retryTimer);
      const res = await emitWithAck<JoinData>(socket, 'event:join', { eventId, role }, 8000);
      if (disposed) return;
      if (!res.ok) {
        setJoined(false);
        if (res.status === 404) {
          setJoinError(res.error);
          return;
        }
        if (res.status === 401) {
          // Session expired while the page was open: show the sign-in screen.
          window.dispatchEvent(new Event('eventcontrol:unauthenticated'));
          return;
        }
        // Timeouts and server hiccups fix themselves: try again shortly.
        retry = Math.min(retry + 1, 5);
        if (socket.connected) retryTimer = window.setTimeout(() => void join(), 500 * 2 ** retry);
        return;
      }
      retry = 0;
      setJoinError(null);
      setJoined(true);
      if (res.data) {
        acceptDisplay(res.data.display);
        setTimer(res.data.timer);
        setPresence(res.data.presence);
      }
      if (joinedOnce) handlersRef.current.onResync?.();
      joinedOnce = true;
      void syncClock();
    };

    socket.on('connect', () => {
      setConnected(true);
      void join();
    });
    socket.on('disconnect', () => {
      window.clearTimeout(retryTimer);
      setConnected(false);
      setJoined(false);
    });
    socket.on('display:update', acceptDisplay);
    socket.on('timer:update', (t: TimerSnapshot) => setTimer(t));
    socket.on('presence:update', (p: Presence) => setPresence(p));
    socket.on('queue:changed', () => handlersRef.current.onQueueChanged?.());
    socket.on('media:changed', () => handlersRef.current.onMediaChanged?.());
    socket.on('schedule:changed', () => handlersRef.current.onScheduleChanged?.());
    socket.on('screens:changed', () => handlersRef.current.onScreensChanged?.());
    socket.on('event:changed', () => handlersRef.current.onEventChanged?.());
    socket.on('event:deleted', () => handlersRef.current.onEventDeleted?.());
    socket.on('display:video', (p: { action: 'play' | 'pause' | 'restart' }) => handlersRef.current.onVideo?.(p.action));
    socket.on('display:fullscreen', () => handlersRef.current.onFullscreenRequest?.());
    socket.on('display:fullscreen-result', (p: { ok: boolean }) => handlersRef.current.onFullscreenResult?.(p.ok));

    // Coming back to the tab: reconnect immediately, and refresh anything that may be stale.
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      if (!socket.connected) {
        socket.connect();
        return;
      }
      void syncClock();
      if (hiddenAt && Date.now() - hiddenAt > 30_000) handlersRef.current.onResync?.();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const onOnline = () => !socket.connected && socket.connect();
    window.addEventListener('online', onOnline);

    // Re-sync the clock periodically; drift matters for long countdowns.
    const clockTimer = window.setInterval(() => void syncClock(), 60_000);

    return () => {
      disposed = true;
      window.clearInterval(clockTimer);
      window.clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [eventId, role, acceptDisplay]);

  const send = useCallback(
    async (command: ControlCommand): Promise<AckResponse> => {
      const socket = socketRef.current;
      if (!socket) return { ok: false, error: 'Not connected to the server.' };
      const res = await emitWithAck(socket, 'control', command);
      // Signed out meanwhile (sign-in expired or account removed): show the sign-in screen.
      if (!res.ok && res.status === 401) window.dispatchEvent(new Event('eventcontrol:unauthenticated'));
      if (res.ok && res.data && typeof res.data === 'object') {
        const data = res.data as Partial<DisplaySnapshot & TimerSnapshot>;
        // Apply acknowledged state immediately (the broadcast will confirm it).
        if ('mode' in data && 'version' in data) acceptDisplay(data as DisplaySnapshot);
        else if ('durationMs' in data && 'status' in data) setTimer(data as TimerSnapshot);
      }
      return res;
    },
    [acceptDisplay],
  );

  const emitRaw = useCallback((event: string, payload: unknown) => {
    socketRef.current?.emit(event, payload);
  }, []);

  return { connected, joined, joinError, display, timer, presence, clockOffset, send, emitRaw };
}
