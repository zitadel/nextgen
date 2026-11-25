/**
 * The Svelte widget components of `@zitadel/sdk-sveltekit`, for pages and layouts.
 *
 * {@link ZitadelLogin}, {@link ZitadelLogout} and {@link ZitadelSession} wrap the
 * `<zitadel-login>`, `<zitadel-logout>` and `<zitadel-session>` custom elements. They come from
 * `@zitadel/sdk-svelte`, which this entry re-exports by name. The re-export exists so that an app
 * installs and imports one package for everything Zitadel adds to SvelteKit: the `handle` hook from
 * the server entry, the browser configuration from the client entry and the widgets from this one.
 * If the widgets ever move to another package, only this file changes and an app's imports stay as
 * they are.
 *
 * Nothing here renders on the server beyond the element tag and its plain attributes. The sign-in
 * form itself is drawn only in the browser, so the components are safe to use in server-rendered
 * pages. Call {@link configureZitadel} before the widgets mount, or pass a project handle to each
 * one.
 *
 * This entry is separate from the server entry on purpose. The server entry has to load on edge
 * runtimes and must not pull the widget package, and its custom-element registration, into a
 * server bundle.
 *
 * @example
 * ```html
 * <script lang="ts">
 *   import { ZitadelLogin, configureZitadel } from "@zitadel/sdk-sveltekit/components";
 *
 *   const project = configureZitadel({ projectId: "…" });
 * </script>
 *
 * <ZitadelLogin {project} />
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
} from "@zitadel/sdk-svelte";
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
} from "@zitadel/sdk-svelte";
