import {
  type SessionSnapshot,
  type SessionStoreOptions,
  sessionStore,
} from "@zitadel/sdk-core/session";
import * as React from "react";

/**
 * The state {@link useSession} returns: the session snapshot and a way to read it again.
 *
 * The snapshot part is flat plain data: `status`, `session`, `error` and `isRefreshing`. They are
 * documented on {@link SessionSnapshot}. The session never carries a token, because the token is
 * an `HttpOnly` cookie that client code cannot read.
 */
export type UseSessionResult = SessionSnapshot & {
  /**
   * Reads the session again and updates every component that uses the same project.
   *
   * Call it from the `onFlowComplete` callback of {@link ZitadelLogin} or the `onSignout`
   * callback of {@link ZitadelLogout} or {@link ZitadelSession} to update the UI in place instead
   * of waiting for the next page load. It resolves with the snapshot of the newest read, which can
   * be a read that started after this call, and it never rejects. A failed read resolves with a
   * snapshot whose `error` is set, and the earlier answer stays visible.
   *
   * @returns The snapshot of the newest read.
   */
  refresh: () => Promise<SessionSnapshot>;
};

/**
 * Reads whether a user is signed in, and who, for an app's own UI.
 *
 * Use it for header navigation, account menus and route guards, where the stock
 * {@link ZitadelSession} card is not enough. It binds React to {@link sessionStore} with
 * `useSyncExternalStore`: the first component that uses it asks the server, with the same
 * `GET /sessions/me` read that the {@link ZitadelSession} card performs, and every component that
 * resolves to the same project and proxy path shares that one read, so a header, a menu and a
 * guard cause one request. When the last component leaves, the read is dropped one microtask
 * later, so a later mount reads again while React StrictMode's simulated remount still reads
 * once.
 *
 * On a server, and during hydration, the hook returns the `loading` status and reads nothing, so
 * the first client render matches the server markup. Treat `loading` as unknown, not as signed
 * out. A failed read does not mean signed out either: the `error` status means no answer exists
 * yet, and a later failed refresh keeps the last answer and reports `error` beside it, so
 * signed-in UI does not vanish on a transient failure. Do not redirect to the sign-in page on
 * `error`.
 *
 * Sign-in and sign-out navigate (`postSignInUrl`, `postSignOutUrl`), and the next page load reads
 * the session again. To update in place instead, call `refresh` from the widget callbacks.
 *
 * @example
 * ```tsx
 * import { useSession } from "@zitadel/sdk-react";
 *
 * export function AccountMenu() {
 *   const { status, session } = useSession({ projectId: "296547382910273" });
 *   if (status === "loading") {
 *     return null;
 *   }
 *   if (status === "error") {
 *     return <span role="alert">Session unavailable</span>;
 *   }
 *   return status === "authenticated"
 *     ? <a href="/profile">{session?.display ?? session?.identifier ?? "Account"}</a>
 *     : <a href="/login">Sign in</a>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Update the menu in place after the widget signs the user in.
 * const { refresh } = useSession();
 * <ZitadelLogin onFlowComplete={() => refresh()} />;
 * ```
 *
 * @param options - Which project to read: `project`, `projectId` and `proxyPath`, as the widgets
 *   take them. Unset values fall back to {@link configureZitadel}, and the proxy path then to
 *   `/__nextgen`. Without any project id the snapshot is an `error` with the code
 *   `session.no_project`, which is a misconfiguration and not a signed-out visitor.
 * @returns The snapshot and {@link UseSessionResult | refresh}. The session holds `userId`,
 *   `identifier`, `identifierProperty` and `display`, and never a token.
 * @see {@link sessionStore}
 * @see {@link getSession}
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
