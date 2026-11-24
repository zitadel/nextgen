import {
  type SessionSnapshot,
  type SessionStoreOptions,
  sessionStore,
} from "@zitadel/sdk-core/session";
import * as React from "react";

/** The state {@link useSession} returns: the session snapshot and a way to read it again. */
export type UseSessionResult = SessionSnapshot & {
  /**
   * Reads the session again and updates every component using the same
   * project. Resolves with the newest read's snapshot; never rejects.
   */
  refresh: () => Promise<SessionSnapshot>;
};

/**
 * Reads whether a user is signed in, and who, for an app's own UI: header
 * navigation, account menus, route guards. It binds React to
 * `sessionStore()` from `@zitadel/sdk-core/session`: the first component
 * using it asks the server (the `GET /sessions/me` read the `ZitadelSession`
 * card performs), and every component using the same project shares that
 * read. A server renders `loading` and reads nothing.
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
export function useSession(options: SessionStoreOptions = {}): UseSessionResult {
  const store = sessionStore(options);
  const snapshot = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  return React.useMemo(() => ({ ...snapshot, refresh: store.refresh }), [snapshot, store]);
}
