import { getZitadelConfig, type ZitadelProject } from "@zitadel/sdk-core/config";

/**
 * Returns the current project handle.
 *
 * It reads the global configuration that the module's plugin set with `configureZitadel`, which
 * is built from the public project id and the proxy path. Pass the handle to a widget through its
 * `project` prop when you want the data flow to be explicit. A widget without a `project` prop
 * falls back to the same global configuration, so the prop is optional.
 *
 * Importing this composable from `@zitadel/sdk-nuxt` also loads the widget elements in the
 * browser, because the entry registers them. The module's client plugin does the same, so this
 * rarely matters.
 *
 * @returns The current {@link ZitadelProject}, or `null` when the plugin has not configured one,
 *   for example because no project id is set.
 *
 * @example
 * ```html
 * <script setup lang="ts">
 * import { useZitadelProject } from "@zitadel/sdk-nuxt";
 *
 * const project = useZitadelProject();
 * </script>
 *
 * <template>
 *   <zitadel-login :project="project" post-sign-in-url="/admin" />
 * </template>
 * ```
 */
export function useZitadelProject(): ZitadelProject | null {
  return getZitadelConfig();
}
