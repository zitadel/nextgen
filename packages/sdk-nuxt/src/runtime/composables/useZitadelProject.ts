import {
  getZitadelConfig,
  type ZitadelProject,
} from '@zitadel/api/config';

/**
 * Returns the current Zitadel project handle.
 *
 * Reads from the global config set by `configureZitadel()` in the
 * Nextgen Nuxt plugin. Pass the returned handle to web components
 * via the `:project` prop for explicit data flow.
 *
 * ```vue
 * <script setup lang="ts">
 * import { useZitadelProject } from '@zitadel/sdk-nuxt';
 *
 * const project = useZitadelProject();
 * </script>
 *
 * <template>
 *   <zitadel-login :project="project" post-sign-in-url="/admin" />
 * </template>
 * ```
 *
 * @returns The current {@link ZitadelProject}, or `null` if the plugin
 *          has not been configured (e.g. missing `projectId`).
 */
export function useZitadelProject(): ZitadelProject | null {
  return getZitadelConfig();
}
