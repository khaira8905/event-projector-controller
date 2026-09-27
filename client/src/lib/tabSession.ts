/**
 * Signing in lasts as long as the console is open: closing the tab (or the last console tab)
 * means signing in again. The server cookie can't know when a tab closes, so each tab keeps a
 * flag in sessionStorage — which the browser drops with the tab — and a freshly opened tab
 * asks the other open tabs whether one of them is signed in. Reloading a tab keeps the flag.
 */

const KEY = 'ec.tab-signed-in';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ec-auth') : null;

function readFlag(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    // Storage blocked: never lock someone out over it; the cookie still protects the console.
    return true;
  }
}

export function markTabSignedIn() {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    /* see readFlag */
  }
}

export function clearTabSignedIn() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* see readFlag */
  }
}

// Other tabs asking "is anyone here signed in?" get an answer from the ones that are.
channel?.addEventListener('message', (e) => {
  if (e.data === 'ping' && readFlag()) channel.postMessage('pong');
});

/** True when this tab signed in, or another open console tab of this browser did. */
export async function tabIsSignedIn(): Promise<boolean> {
  if (readFlag()) return true;
  if (!channel) return false;
  const answered = await new Promise<boolean>((resolve) => {
    const done = (value: boolean) => {
      window.clearTimeout(timer);
      channel.removeEventListener('message', onMessage);
      resolve(value);
    };
    const onMessage = (e: MessageEvent) => e.data === 'pong' && done(true);
    const timer = window.setTimeout(() => done(false), 400);
    channel.addEventListener('message', onMessage);
    channel.postMessage('ping');
  });
  if (answered) markTabSignedIn();
  return answered;
}

/** Signing out in one tab signs every open tab out. */
export function announceSignOut() {
  channel?.postMessage('signed-out');
}

export function onSignOutElsewhere(fn: () => void): () => void {
  const onMessage = (e: MessageEvent) => e.data === 'signed-out' && fn();
  channel?.addEventListener('message', onMessage);
  return () => channel?.removeEventListener('message', onMessage);
}
