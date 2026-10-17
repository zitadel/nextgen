/**
 * Short-lived caches for reads that belong to the signed-in person.
 *
 * The `_authed` guard runs on every navigation and the shell mounts beside the
 * screen, so a read both need — `GET /users/me/projects` — would otherwise go
 * out once per caller on the same landing. A cache is shared by its callers for
 * `ttlMs`, keeps an in-flight read rather than starting a second, and never
 * keeps a failure. Every cache is dropped with the session
 * (`invalidateSessionCache` in `auth/session.ts`), so the next person to sign in
 * never reads the previous one's answer.
 *
 * Deliberately free of the API client, so the test setup can clear the caches
 * without initialising it.
 */
const caches = new Set<{ clear(): void }>();

/** Drops every cached answer. */
export function clearSessionCaches(): void {
  for (const cache of caches) cache.clear();
}

/** A cached read: call it to read, `clear()` to drop the answer and re-read wherever it is shown. */
export interface SessionCached<T> {
  (): Promise<T>;
  clear(): void;
  /** Called after `clear()`, so a component showing the answer can read it again. */
  subscribe(listener: () => void): () => void;
}

/** A read shared by its callers for `ttlMs`. */
export function sessionCached<T>(load: () => Promise<T>, ttlMs: number): SessionCached<T> {
  let entry: { at: number; value: Promise<T> } | undefined;
  const listeners = new Set<() => void>();
  const read = () => {
    if (entry && Date.now() - entry.at < ttlMs) return entry.value;
    const value = load();
    const current = { at: Date.now(), value };
    entry = current;
    value.catch(() => {
      if (entry === current) entry = undefined;
    });
    return value;
  };
  const cached = Object.assign(read, {
    // One path for both callers: dropping it with the session
    // (clearSessionCaches) re-reads it wherever it is shown, as clear() does.
    clear: () => {
      entry = undefined;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  caches.add(cached);
  return cached;
}
