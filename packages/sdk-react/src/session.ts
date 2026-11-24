import type { ZitadelProject } from "@zitadel/api/config";
import { type ClientSession, getSession } from "@zitadel/sdk-core/session";
import * as React from "react";

/** Options for {@link useSession}: the same project props the widgets take. */
export type UseSessionOptions = {
  /** The handle from `configureZitadel(...)`. Wins over `projectId` and `proxyPath`. */
  project?: ZitadelProject;
  /** Project id, read when no `project` handle is passed. */
  projectId?: string;
  /** Same-origin path the read calls, read when no `project` handle is passed. */
  proxyPath?: string;
};

/**
 * Where the session read stands: `loading` until the server answers,
 * `authenticated` or `unauthenticated` from its answer, and `error` when it
 * answered something else (a misrouted proxy, an unreachable backend), which
 * is "unknown", never signed out.
 */
export type SessionStatus = "loading" | "authenticated" | "unauthenticated" | "error";

/** The state {@link useSession} returns. */
export type UseSessionResult = {
  status: SessionStatus;
  /** The signed-in user's client-safe identity; `null` unless `status` is `authenticated`. */
  session: ClientSession | null;
  /** Why the read failed; `null` unless `status` is `error`. */
  error: Error | null;
  /** Reads the session again and updates every component using the same project. */
  refresh: () => Promise<void>;
};

type Snapshot = Omit<UseSessionResult, "refresh">;

const loading: Snapshot = { status: "loading", session: null, error: null };
const signedOut: Snapshot = { status: "unauthenticated", session: null, error: null };

/** One read per project and proxy path, shared by every component on the page. */
type Entry = {
  snapshot: Snapshot;
  listeners: Set<() => void>;
  started: boolean;
  /** Counts reads, so an answer that a later read overtook is dropped. */
  generation: number;
};

const entries = new Map<string, Entry>();

function entryFor(key: string): Entry {
  let entry = entries.get(key);
  if (!entry) {
    entry = { snapshot: loading, listeners: new Set(), started: false, generation: 0 };
    entries.set(key, entry);
  }
  return entry;
}

function publish(entry: Entry, snapshot: Snapshot): void {
  entry.snapshot = snapshot;
  for (const listener of entry.listeners) listener();
}

/**
 * Reads the session into the entry. A refresh keeps the current snapshot on
 * screen until the answer arrives, so signed-in chrome does not flash.
 */
function load(entry: Entry, projectId?: string, proxyPath?: string): Promise<void> {
  entry.started = true;
  const generation = ++entry.generation;
  return getSession({ projectId, proxyPath }).then(
    (auth) => {
      if (generation !== entry.generation) return;
      publish(
        entry,
        auth.isAuthenticated
          ? { status: "authenticated", session: auth.session, error: null }
          : signedOut,
      );
    },
    (error: unknown) => {
      if (generation !== entry.generation) return;
      publish(entry, {
        status: "error",
        session: null,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    },
  );
}

/**
 * Reads whether a user is signed in, and who, for an app's own UI: header
 * navigation, account menus, route guards. It asks the server through
 * `getSession()` (the `GET /sessions/me` read the `ZitadelSession` card
 * performs) when the first component using it mounts; every component using
 * the same project shares that one read.
 *
 * ```tsx
 * import { useSession } from "@zitadel/sdk-react";
 *
 * export function AccountMenu() {
 *   const { status, session } = useSession({ project });
 *   if (status === "loading") return null;
 *   if (status === "error") return <span role="alert">Session unavailable</span>;
 *   return status === "authenticated"
 *     ? <a href="/profile">{session?.display ?? session?.identifier ?? "Account"}</a>
 *     : <a href="/login">Sign in</a>;
 * }
 * ```
 *
 * Sign-in and sign-out navigate (`postSignInUrl`, `postSignOutUrl`), and the
 * next page load reads the session again. To update in place instead, call
 * `refresh()` from the widgets' `onFlowComplete` or `onSignout` callback.
 */
export function useSession(options: UseSessionOptions = {}): UseSessionResult {
  const projectId = options.project?.projectId ?? options.projectId;
  const proxyPath = options.project?.proxyPath ?? options.proxyPath;
  // A server renders `loading` and reads nothing, so it keeps no entry: a
  // long-lived server would otherwise hold one per project it ever rendered.
  const entry =
    typeof window === "undefined" ? null : entryFor(`${projectId ?? ""}\n${proxyPath ?? ""}`);

  const subscribe = React.useCallback(
    (listener: () => void) => {
      if (!entry) return () => {};
      entry.listeners.add(listener);
      if (!entry.started) void load(entry, projectId, proxyPath);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    [entry, projectId, proxyPath],
  );
  const snapshot = React.useSyncExternalStore(
    subscribe,
    () => entry?.snapshot ?? loading,
    () => loading,
  );
  const refresh = React.useCallback(
    () => (entry ? load(entry, projectId, proxyPath) : Promise.resolve()),
    [entry, projectId, proxyPath],
  );
  return React.useMemo(() => ({ ...snapshot, refresh }), [snapshot, refresh]);
}

/** How many shared reads the page holds. **Test-only**. */
export function _sessionEntryCountForTesting(): number {
  return entries.size;
}

/** Forgets every shared read. **Test-only**: each test starts from a fresh page. */
export function _resetSessionsForTesting(): void {
  entries.clear();
}
