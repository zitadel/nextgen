import { getZitadelConfig, type ZitadelProject } from "@zitadel/api/config";
import { apiBaseUrl } from "@zitadel/api/runtime/base-url";

import type { ClientSession } from "./middleware.js";
import { getSession } from "./session-read.js";

/**
 * Where the session stands. `authenticated` and `unauthenticated` are the
 * server's last answer; `error` means there is no answer yet because the read
 * failed or could not be made, which is "unknown", never signed out.
 */
export type SessionStatus = "loading" | "authenticated" | "unauthenticated" | "error";

/**
 * Why a read gave no answer. `session.no_project`: no project id is known
 * (none passed and `configureZitadel()` has not run), a misconfiguration.
 * `session.read_failed`: the server answered something other than a session
 * or a signed-out (a misrouted proxy, an unreachable backend).
 */
export type SessionErrorCode = "session.no_project" | "session.read_failed";

/** A failed read, as plain data. */
export type SessionError = {
  /** A stable code to branch on. */
  code: SessionErrorCode;
  /** A human-readable description, for logs; not stable. */
  message: string;
};

/**
 * The session as a store holds it: flat, plain data, so a framework can
 * serialise it.
 *
 * `status` and `session` are the last answer the server gave. A refresh keeps
 * them while it runs (`isRefreshing`), and a refresh that fails keeps them too
 * and reports the failure in `error`; signed-in chrome does not disappear on a
 * transient failure. `error` clears on the next successful read.
 */
export type SessionSnapshot = {
  /** Where the read stands: `loading` until the first answer, then the last answer the server gave. */
  status: SessionStatus;
  /** The signed-in user's client-safe identity; `null` unless `status` is `authenticated`. */
  session: ClientSession | null;
  /** Why the latest read failed; `null` when it succeeded. */
  error: SessionError | null;
  /** Whether a read is running while an earlier answer is shown. */
  isRefreshing: boolean;
};

/** Which session a store reads: the widgets' project props. */
export type SessionStoreOptions = {
  /** The handle from `configureZitadel(...)`. Wins over `projectId` and `proxyPath`. */
  project?: ZitadelProject;
  /** Project id, read when no `project` handle is passed. */
  projectId?: string;
  /** Same-origin path the read calls, read when no `project` handle is passed. */
  proxyPath?: string;
};

/**
 * One session read, shared by everything on the page that reads the same
 * project through the same proxy path. A framework SDK binds its reactivity to
 * `subscribe` and `getSnapshot`; `getServerSnapshot` is what a server renders
 * and what hydration starts from.
 */
export type SessionStore = {
  /** The current snapshot; the same object until it changes. */
  getSnapshot: () => SessionSnapshot;
  /** Always the `loading` snapshot. */
  getServerSnapshot: () => SessionSnapshot;
  /**
   * Listens for snapshot changes. The first subscriber starts the read; when
   * the last one leaves, the read is forgotten, so a later subscriber reads
   * again.
   */
  subscribe: (listener: () => void) => () => void;
  /**
   * Reads the session again. Resolves with the snapshot of the newest read,
   * including one started after this call, and never rejects.
   */
  refresh: () => Promise<SessionSnapshot>;
  /**
   * Resolves with the first snapshot that is not `loading`, for a route guard
   * or loader that waits for an answer without subscribing. Never rejects.
   */
  settled: () => Promise<SessionSnapshot>;
};

const DEFAULT_PROXY_PATH = "/__nextgen";

const loading: SessionSnapshot = {
  status: "loading",
  session: null,
  error: null,
  isRefreshing: false,
};

/** A server reads nothing and keeps no state; it renders `loading`. */
const serverStore: SessionStore = {
  getSnapshot: () => loading,
  getServerSnapshot: () => loading,
  subscribe: () => () => {},
  refresh: () => Promise.resolve(loading),
  settled: () => Promise.resolve(loading),
};

type Entry = {
  snapshot: SessionSnapshot;
  listeners: Set<() => void>;
  /** Counts reads, so an answer that a later read overtook is dropped. */
  generation: number;
  /** Resolves with the newest read's snapshot. */
  latest: Promise<SessionSnapshot>;
};

/** The shared reads, keyed by resolved project and proxy path. */
const entries = new Map<string, Entry>();
/** One handle per key, so a framework that re-runs `sessionStore()` gets the same one. */
const stores = new Map<string, SessionStore>();

function publish(entry: Entry, snapshot: SessionSnapshot): void {
  entry.snapshot = snapshot;
  for (const listener of entry.listeners) listener();
}

/**
 * Returns the shared session store for a project. Pure: it reads nothing and
 * creates no shared state until something subscribes, refreshes or waits.
 *
 * The project id and proxy path resolve now, falling back to
 * `configureZitadel()` and `"/__nextgen"`, and the store is keyed on what they
 * resolve to: `{}` and `{ projectId }` share a read when they name the same
 * project. With no project known, the read reports `error` with the code
 * `session.no_project` instead of reading as signed out.
 *
 * On a server it returns a store that stays `loading` and reads nothing.
 */
export function sessionStore(options: SessionStoreOptions = {}): SessionStore {
  if (typeof window === "undefined") {
    return serverStore;
  }
  const configured = getZitadelConfig();
  const projectId = options.project?.projectId || options.projectId || configured?.projectId || "";
  const proxyPath = apiBaseUrl(
    options.project?.proxyPath ?? options.proxyPath ?? configured?.proxyPath ?? DEFAULT_PROXY_PATH,
  );
  const key = `${projectId}\n${proxyPath}`;
  let store = stores.get(key);
  if (!store) {
    store = createStore(key, projectId, proxyPath);
    stores.set(key, store);
  }
  return store;
}

function createStore(key: string, projectId: string, proxyPath: string): SessionStore {
  /** Starts a read and returns what resolves with the newest read's snapshot. */
  function read(entry: Entry): Promise<SessionSnapshot> {
    const generation = ++entry.generation;
    if (entry.snapshot.status !== "loading" && !entry.snapshot.isRefreshing) {
      publish(entry, { ...entry.snapshot, isRefreshing: true });
    }
    const answer = readOnce(entry.snapshot).then((snapshot) => {
      // A later read overtook this one: wait for that answer instead.
      if (generation !== entry.generation) return entry.latest;
      publish(entry, snapshot);
      return snapshot;
    });
    entry.latest = answer;
    return answer;
  }

  /** The snapshot one read leads to from `previous`. */
  async function readOnce(previous: SessionSnapshot): Promise<SessionSnapshot> {
    if (!projectId) {
      return failed(previous, {
        code: "session.no_project",
        message:
          "No project id is known: pass `project` or `projectId`, or call configureZitadel() first.",
      });
    }
    try {
      const auth = await getSession({ projectId, proxyPath });
      return auth.isAuthenticated
        ? { status: "authenticated", session: auth.session, error: null, isRefreshing: false }
        : { status: "unauthenticated", session: null, error: null, isRefreshing: false };
    } catch (error) {
      return failed(previous, {
        code: "session.read_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Creates the shared entry and starts its first read. */
  function ensureEntry(): Entry {
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        snapshot: loading,
        listeners: new Set(),
        generation: 0,
        latest: Promise.resolve(loading),
      };
      entries.set(key, entry);
      read(entry);
    }
    return entry;
  }

  /**
   * Forgets the entry once nothing listens. Deferred a microtask, so a
   * subscriber that leaves and comes straight back (React StrictMode's
   * simulated remount) keeps the read instead of starting another.
   */
  function dropWhenUnused(entry: Entry): void {
    queueMicrotask(() => {
      if (entry.listeners.size === 0 && entries.get(key) === entry) entries.delete(key);
    });
  }

  return {
    getSnapshot: () => entries.get(key)?.snapshot ?? loading,
    getServerSnapshot: () => loading,
    subscribe(listener) {
      const entry = ensureEntry();
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) dropWhenUnused(entry);
      };
    },
    refresh() {
      const existing = entries.get(key);
      const entry = existing ?? ensureEntry();
      const answer = existing ? read(entry) : entry.latest;
      void answer.then(() => entry.listeners.size === 0 && dropWhenUnused(entry));
      return answer;
    },
    settled() {
      const entry = ensureEntry();
      const answer =
        entry.snapshot.status === "loading" ? entry.latest : Promise.resolve(entry.snapshot);
      void answer.then(() => entry.listeners.size === 0 && dropWhenUnused(entry));
      return answer;
    },
  };
}

/**
 * A failed read keeps the last answer and reports the failure beside it; with
 * no answer yet, the status is `error`.
 */
function failed(previous: SessionSnapshot, error: SessionError): SessionSnapshot {
  if (previous.status === "authenticated" || previous.status === "unauthenticated") {
    return { ...previous, error, isRefreshing: false };
  }
  return { status: "error", session: null, error, isRefreshing: false };
}

/** Forgets every shared read and handle. **Test-only**: each test starts from a fresh page. */
export function _resetSessionStoresForTesting(): void {
  entries.clear();
  stores.clear();
}
