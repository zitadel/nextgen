import { getApi, getZitadelConfig } from "@zitadel/api/config";

/**
 * Returns the typed Zitadel API client for the current project, so an app can
 * call the API without depending on `@zitadel/api` itself.
 *
 * Reads the project the client plugin configured, so call it in the browser
 * (for example from `onMounted`): during SSR no project is configured yet and
 * it throws.
 *
 * ```vue
 * <script setup lang="ts">
 * onMounted(async () => {
 *   const session = await useZitadelApi().getMySession();
 * });
 * </script>
 * ```
 *
 * @throws When no project has been configured (missing `projectId`).
 */
export function useZitadelApi(): ReturnType<typeof getApi> {
  const project = getZitadelConfig();
  if (!project) {
    throw new Error(
      "useZitadelApi(): no Zitadel project is configured. Set NUXT_PUBLIC_ZITADEL_PROJECT_ID and call it in the browser.",
    );
  }
  return getApi(project);
}
