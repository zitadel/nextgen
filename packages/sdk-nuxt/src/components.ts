/**
 * The Vue widget components of `@zitadel/sdk-nuxt`, for pages, layouts and components.
 *
 * {@link ZitadelLogin}, {@link ZitadelLogout} and {@link ZitadelSession} wrap the
 * `<zitadel-login>`, `<zitadel-logout>` and `<zitadel-session>` custom elements. They come from
 * `@zitadel/sdk-vue`, which this entry re-exports by name. The re-export exists so that an app
 * imports everything Zitadel adds to Nuxt from one package: the server middleware from
 * the server entry, the browser configuration from the client entry and the typed widgets from this
 * one. An app that prefers the raw custom elements can keep using them, because the Nuxt module
 * still registers them. If the widgets ever move to another package, only this file changes and an
 * app's imports stay as they are.
 *
 * The sign-in form is drawn in the browser. Call {@link configureZitadel} before the widgets mount,
 * or pass a project handle to each one.
 *
 * @example
 * ```html
 * <script setup lang="ts">
 * import { ZitadelLogin, configureZitadel } from "@zitadel/sdk-nuxt/components";
 *
 * const project = configureZitadel({ projectId: "…" });
 * </script>
 *
 * <template>
 *   <ZitadelLogin :project="project" />
 * </template>
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
} from "@zitadel/sdk-vue";
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
} from "@zitadel/sdk-vue";
