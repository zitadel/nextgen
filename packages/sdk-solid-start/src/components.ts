/**
 * The Solid widget components of `@zitadel/sdk-solid-start`, for routes and components.
 *
 * {@link ZitadelLogin}, {@link ZitadelLogout} and {@link ZitadelSession} wrap the
 * `<zitadel-login>`, `<zitadel-logout>` and `<zitadel-session>` custom elements. They come from
 * `@zitadel/sdk-solid`, which this entry re-exports by name. The re-export exists so that an app
 * imports everything Zitadel adds to SolidStart from one package: the middleware from
 * the server entry, the browser configuration from the client entry and the widgets from this one.
 * If the widgets ever move to another package, only this file changes and an app's imports stay as
 * they are.
 *
 * The widget module registers custom elements when it is imported, so load it in the browser only,
 * with SolidStart's `clientOnly` as the scaffolded routes do, and never import it at module scope
 * on the server. Call {@link configureZitadel} before the widgets mount, or pass a project handle
 * to each one.
 *
 * This entry is separate from the server entry on purpose. The server entry has to load on edge
 * runtimes and must not pull the widget package, and its custom-element registration, into a
 * server bundle.
 *
 * @example
 * ```tsx
 * import { ZitadelLogin, configureZitadel } from "@zitadel/sdk-solid-start/components";
 *
 * const project = configureZitadel({ projectId: "…" });
 *
 * export default function Login() {
 *   return <ZitadelLogin project={project} />;
 * }
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
} from "@zitadel/sdk-solid";
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
} from "@zitadel/sdk-solid";
