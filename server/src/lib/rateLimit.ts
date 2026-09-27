/**
 * Small in-memory rate limits ("at most N per hour for this key"). Old entries are dropped as
 * they expire, so the table doesn't grow with every visitor the server has ever seen.
 */
const hits = new Map<string, number[]>();

setInterval(() => {
  const now = Date.now();
  for (const [key, times] of hits) {
    const recent = times.filter((t) => t > now);
    if (recent.length) hits.set(key, recent);
    else hits.delete(key);
  }
}, 10 * 60_000).unref();

/** Counts one use of `key`; false (and not counted) when `max` uses happened within `windowMs`. */
export function allow(key: string, max: number, windowMs = 3600_000): boolean {
  const now = Date.now();
  // Stored as expiry times, so the clean-up doesn't need to know each key's window.
  const recent = (hits.get(key) ?? []).filter((t) => t > now);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now + windowMs);
  hits.set(key, recent);
  return true;
}

/** Starts `key` afresh (e.g. after a successful sign-in). */
export function forget(key: string) {
  hits.delete(key);
}
