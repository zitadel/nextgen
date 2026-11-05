import { getApi, getZitadelConfig } from "@zitadel/api/config";

/**
 * Returns the typed Zitadel API client for the current project, so an app can
 * call the API without depending on `@zitadel/api` itself.
 *
 * Reads the project the SDK's plugin configured from the project id. It works on
 * the server and in the browser alike; it throws only when no project id is set.
 * Widgets and session reads run in the browser, so call it from there (for
 * example from `onMounted`).
 *
 * ```vue
 * <script setup lang="ts">
 * onMounted(async () => {
 *   const session = await useZitadelApi().getMySession();
 * });
 * </script>
 * ```
 *
 * @throws When no project is configured, because no project id is set.
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
