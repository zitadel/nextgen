/**
 * The Qwik widget components of `@zitadel/sdk-qwik-router`, for routes and layouts.
 *
 * {@link ZitadelLogin}, {@link ZitadelLogout} and {@link ZitadelSession} wrap the
 * `<zitadel-login>`, `<zitadel-logout>` and `<zitadel-session>` custom elements. They come from
 * `@zitadel/sdk-qwik`, which this entry re-exports by name. The re-export exists so that an app
 * imports everything Zitadel adds to Qwik Router from one package: the `onRequest`
 * hook from the server entry, the browser configuration from the client entry and the widgets from
 * this one. If the widgets ever move to another package, only this file changes and an app's
 * imports stay as they are.
 *
 * The sign-in form is drawn in the browser. Call {@link configureZitadel} before the widgets mount,
 * or pass a project handle to each one.
 *
 * This entry is separate from the server entry on purpose. The server entry has to load on edge
 * runtimes and must not pull the widget package, and its custom-element registration, into a
 * server bundle.
 *
 * @example
 * ```tsx
 * import { component$ } from "@qwik.dev/core";
 * import { ZitadelLogin, configureZitadel } from "@zitadel/sdk-qwik-router/components";
 *
 * const project = configureZitadel({ projectId: "…" });
 *
 * export default component$(() => <ZitadelLogin project={project} />);
 * ```
 *
 * @module
 */

export {
  businessLocales,
  configureZitadel,
  ZitadelLogin,
  ZitadelLogout,
  ZitadelSession,
} from "@zitadel/sdk-qwik";
export type {
  ZitadelFlowPurpose,
  ZitadelFlowStep,
  ZitadelFlowBehavior,
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowStepDetail,
  ZitadelLoginProps,
  ZitadelLogoutProps,
  ZitadelSessionProps,
  ZitadelSignoutDetail,
} from "@zitadel/sdk-qwik";
