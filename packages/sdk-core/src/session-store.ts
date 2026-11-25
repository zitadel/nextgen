import { getZitadelConfig, type ZitadelProject } from "./config.js";
import { apiBaseUrl } from "@zitadel/api/runtime/base-url";

import type { ZitadelClientSession } from "./middleware.js";
import { getSession } from "./session-read.js";

/**
 * Where the session stands.
 *
 * The `authenticated` and `unauthenticated` values are the last answer of the server. The `loading`
 * value means no answer has arrived yet. The `error` value means there is no answer because the
 * read failed or could not be made, which is unknown and never signed out: do not redirect a user
 * to the sign-in page on it.
 *
 * The server may add values, so handle an unknown one with a default branch.
 */
export type ZitadelSessionStatus = "loading" | "authenticated" | "unauthenticated" | "error";

/**
 * Why a read gave no answer.
 *
 * The `session.no_project` code means that no project id is known, because none was passed and
 * `configureZitadel` has not run; it is a misconfiguration. The `session.read_failed` code means
 * that the server answered something other than a session or a signed-out answer, for example
 * through a misrouted proxy or an unreachable backend.
 *
 * The server may add codes, so handle an unknown one with a default branch.
 */
export type ZitadelSessionErrorCode = "session.no_project" | "session.read_failed";

/**
 * A failed read, as plain data.
 *
 * It is plain data so that a framework can serialize it, for example into a server-rendered page.
 */
export interface ZitadelSessionError {
  /**
   * A stable code to branch on.
   */
  code: ZitadelSessionErrorCode;
  /**
   * A human-readable description of the failure.
   *
   * The text is meant for logs and can change between versions, so do not branch on it.
   */
  message: string;
}

/**
 * The session as a store holds it: flat plain data, so that a framework can serialize it.
 *
 * The status and the session are the last answer that the server gave. A refresh keeps them while
 * it runs and sets {@link ZitadelSessionSnapshot.isRefreshing}. A refresh that fails keeps them too and
 * reports the failure in {@link ZitadelSessionSnapshot.error}, so signed-in chrome does not disappear on
 * a transient failure. The error clears on the next successful read.
 */
export interface ZitadelSessionSnapshot {
  /**
   * Where the read stands.
   *
   * It is `loading` until the first answer, then the last answer that the server gave. On a server
   * and during hydration it is always `loading`, so the first client render matches the server
   * markup.
   */
  status: ZitadelSessionStatus;
  /**
   * The client-safe identity of the signed-in user.
   *
   * It is `null` unless {@link ZitadelSessionSnapshot.status} is `authenticated`. It never carries the
   * session token.
   */
  session: ZitadelClientSession | null;
  /**
   * Why the latest read failed.
   *
   * It is `null` when the latest read succeeded. A failed refresh sets it while the earlier answer
   * stays in {@link ZitadelSessionSnapshot.status} and {@link ZitadelSessionSnapshot.session}.
   */
  error: ZitadelSessionError | null;
  /**
   * Whether a read is running while an earlier answer is shown.
   *
   * Use it to show a subtle busy state without hiding the signed-in chrome. It is `false` during
   * the first read, where the status is `loading`.
   */
  isRefreshing: boolean;
}

/**
 * Which session a store reads.
 *
 * The properties mirror the project props of the widgets. All of them are optional, because each
 * falls back to what `configureZitadel` configured on the page.
 *
 * @example
 * ```ts
 * const options: ZitadelSessionStoreOptions = { projectId: "296547382910273" };
 * ```
 */
export interface ZitadelSessionStoreOptions {
  /**
   * The project handle that `configureZitadel` returned.
   *
   * It wins over {@link ZitadelSessionStoreOptions.projectId} and {@link ZitadelSessionStoreOptions.proxyPath}.
   */
  project?: ZitadelProject;
  /**
   * The project id to read the session for.
   *
   * It is read when no project handle is passed. A session of another project reads as signed out.
   */
  projectId?: string;
  /**
   * The same-origin proxy path that the read calls.
   *
   * It is read when no project handle is passed.
   *
   * @defaultValue The path from `configureZitadel` when it has run, else "/__nextgen".
   */
  proxyPath?: string;
}

/**
 * One session read, shared by everything on the page that reads the same project through the same
 * proxy path.
 *
 * It follows the contract of an external store, so a framework SDK binds its reactivity to
 * {@link ZitadelSessionStore.subscribe} and {@link ZitadelSessionStore.getSnapshot}, and uses
 * {@link ZitadelSessionStore.getServerSnapshot} for what a server renders and what hydration starts from.
 * Sharing the read means that a header, a menu and a guard cause one request and not three.
 */
export interface ZitadelSessionStore {
  /**
   * Returns the current snapshot.
   *
   * It returns the same object until the snapshot changes, which an external-store binding needs to
   * avoid endless re-renders.
   */
  getSnapshot: () => ZitadelSessionSnapshot;
  /**
   * Returns the snapshot to render on a server and to hydrate from.
   *
   * It is always the `loading` snapshot, so the first client render matches the server markup.
   */
  getServerSnapshot: () => ZitadelSessionSnapshot;
  /**
   * Listens for snapshot changes and returns the function that stops listening.
   *
   * The first subscriber starts the read. When the last one leaves, the read is forgotten one
   * microtask later, so a later subscriber reads again, while a subscriber that leaves and comes
   * straight back, as in the simulated remount of React StrictMode, keeps the read instead of
   * starting another.
   *
   * @param listener - The function to call after each change.
   */
  subscribe: (listener: () => void) => () => void;
  /**
   * Reads the session again.
   *
   * It resolves with the snapshot of the newest read, including one that started after this call,
   * and never rejects: a failed read resolves with a snapshot whose error is set. Call it after the
   * widget signs a user in or out, for example from the flow-complete and sign-out handlers, so
   * that the chrome of the app updates in place.
   */
  refresh: () => Promise<ZitadelSessionSnapshot>;
  /**
   * Resolves with the first snapshot that is not `loading`.
   *
   * Use it in a route guard or a loader that waits for an answer without subscribing. It never
   * rejects. On a server it resolves at once with the `loading` snapshot, so do not guard routes
   * with it during server rendering.
   */
  settled: () => Promise<ZitadelSessionSnapshot>;
}

/**
 * The proxy path used when neither the options nor `configureZitadel` name one.
 */
const DEFAULT_PROXY_PATH = "/__nextgen";

/**
 * The snapshot before any answer has arrived.
 */
const loading: ZitadelSessionSnapshot = {
  status: "loading",
  session: null,
  error: null,
  isRefreshing: false,
};

/**
 * The store that a server gets: it reads nothing, keeps no state and renders `loading`.
 */
const serverStore: ZitadelSessionStore = {
  getSnapshot: () => loading,
  getServerSnapshot: () => loading,
  subscribe: () => () => {},
  refresh: () => Promise.resolve(loading),
  settled: () => Promise.resolve(loading),
};

/**
 * The shared state of one read, kept while anything listens to it.
 */
type Entry = {
  snapshot: ZitadelSessionSnapshot;
  listeners: Set<() => void>;
  /**
   * Counts reads, so an answer that a later read overtook is dropped.
   */
  generation: number;
  /**
   * Resolves with the snapshot of the newest read.
   */
  latest: Promise<ZitadelSessionSnapshot>;
};

/**
 * The shared reads, keyed by resolved project and proxy path.
 */
const entries = new Map<string, Entry>();
/**
 * One handle per key, so a framework that runs {@link sessionStore} again gets the same one.
 */
const stores = new Map<string, ZitadelSessionStore>();

/**
 * Stores a new snapshot and notifies the listeners.
 *
 * @param entry - The shared read.
 * @param snapshot - The new snapshot.
 */
function publish(entry: Entry, snapshot: ZitadelSessionSnapshot): void {
  entry.snapshot = snapshot;
  for (const listener of entry.listeners) {
    listener();
  }
}

/**
 * Returns the shared session store for a project.
 *
 * The function is pure: it reads nothing and creates no shared state until something subscribes,
 * refreshes or waits. It returns the same handle for the same project and proxy path, so a
 * framework that runs it again on every render gets a stable object.
 *
 * The project id and the proxy path resolve when the function runs, falling back to
 * `configureZitadel` and `"/__nextgen"`. The store is keyed on what they resolve to, so `{}` and
 * `{ projectId }` share one read when they name the same project. With no project known, the read
 * reports `error` with the code `session.no_project` instead of reading as signed out.
 *
 * On a server it returns a store that stays `loading` and reads nothing. The real read starts in
 * the browser after hydration.
 *
 * @param options - Which project and proxy path to read; both fall back to `configureZitadel`.
 * @returns The store for that project.
 *
 * @example
 * ```ts
 * import { sessionStore } from "@zitadel/sdk-core/session";
 *
 * const store = sessionStore({ projectId: "296547382910273" });
 * const unsubscribe = store.subscribe(() => {
 *   console.log(store.getSnapshot().status);
 * });
 * await store.refresh();
 * unsubscribe();
 * ```
 */
export function sessionStore(options: ZitadelSessionStoreOptions = {}): ZitadelSessionStore {
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

/**
 * Creates the store for one resolved project and proxy path.
 *
 * @param key - The key of the shared read.
 * @param projectId - The resolved project id; empty when none is known.
 * @param proxyPath - The resolved proxy path.
 * @returns The store.
 */
function createStore(key: string, projectId: string, proxyPath: string): ZitadelSessionStore {
  /**
   * Starts a read and returns what resolves with the snapshot of the newest read.
   */
  function read(entry: Entry): Promise<ZitadelSessionSnapshot> {
    const generation = ++entry.generation;
    if (entry.snapshot.status !== "loading" && !entry.snapshot.isRefreshing) {
      publish(entry, { ...entry.snapshot, isRefreshing: true });
    }
    const answer = readOnce(entry.snapshot).then((snapshot) => {
      // A later read overtook this one: wait for that answer instead.
      if (generation !== entry.generation) {
        return entry.latest;
      }
      publish(entry, snapshot);
      return snapshot;
    });
    entry.latest = answer;
    return answer;
  }

  /**
   * Returns the snapshot that one read leads to from the previous snapshot.
   */
  async function readOnce(previous: ZitadelSessionSnapshot): Promise<ZitadelSessionSnapshot> {
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

  /**
   * Creates the shared entry and starts its first read.
   */
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
   * Forgets the entry once nothing listens.
   *
   * It is deferred by a microtask, so a subscriber that leaves and comes straight back, as in the
   * simulated remount of React StrictMode, keeps the read instead of starting another.
   */
  function dropWhenUnused(entry: Entry): void {
    queueMicrotask(() => {
      if (entry.listeners.size === 0 && entries.get(key) === entry) {
        entries.delete(key);
      }
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
        if (entry.listeners.size === 0) {
          dropWhenUnused(entry);
        }
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
 * Builds the snapshot of a failed read.
 *
 * A failed read keeps the last answer and reports the failure beside it. With no answer yet, the
 * status is `error`.
 *
 * @param previous - The snapshot before the read.
 * @param error - The failure.
 * @returns The new snapshot.
 */
function failed(
  previous: ZitadelSessionSnapshot,
  error: ZitadelSessionError,
): ZitadelSessionSnapshot {
  if (previous.status === "authenticated" || previous.status === "unauthenticated") {
    return { ...previous, error, isRefreshing: false };
  }
  return { status: "error", session: null, error, isRefreshing: false };
}

/**
 * Forgets every shared read and handle, so that each test starts from a fresh page.
 *
 * It is for tests only. Calling it in an app drops the reads that mounted components still use.
 *
 * @internal
 */
export function _resetSessionStoresForTesting(): void {
  entries.clear();
  stores.clear();
}
