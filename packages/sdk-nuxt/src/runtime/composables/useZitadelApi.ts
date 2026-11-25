import { getApi, getZitadelConfig } from "@zitadel/sdk-core/config";

/**
 * Returns the typed Zitadel API client for the current project, so an app can call the API
 * without depending on `@zitadel/api` itself.
 *
 * The client is built from the project that the module's plugin configured from the project id
 * and the proxy path, so calls go to the app's same-origin proxy path and carry the session
 * cookie. It can be called on the server and in the browser. Session reads belong in the browser,
 * where the visitor's cookie is, so call it from there, for example from `onMounted`. It is
 * auto-imported, so an app does not import it.
 *
 * @returns The typed API client for the configured project.
 * @throws When no project is configured, because no project id is set. Set
 *   `NUXT_PUBLIC_ZITADEL_PROJECT_ID`.
 *
 * @example
 * ```html
 * <script setup lang="ts">
 * onMounted(async () => {
 *   const session = await useZitadelApi().getMySession();
 * });
 * </script>
 * ```
 */
export function useZitadelApi(): ReturnType<typeof getApi> {
  const project = getZitadelConfig();
  if (!project) {
    throw new Error(
      "useZitadelApi(): no Zitadel project is configured. Set NUXT_PUBLIC_ZITADEL_PROJECT_ID.",
    );
  }
  return getApi(project);
}
