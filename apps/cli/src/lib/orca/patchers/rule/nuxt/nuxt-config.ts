import { builders, generateCode } from "magicast";

import {
  ensureArrayItem,
  ensureEditableObject,
  parseConfigModule,
  resolveDefaultExportObject,
} from "../utils/magicast";
import { configPattern } from "../config-paths";
import { PROXY_PATH } from "../proxy";

const NUXT_MODULE = "@zitadel/sdk-nuxt/module";

/**
 * Builds the pure `edit` transform the file-writer applies to the project's Nuxt
 * config (`nuxt.config.*`): registers the `@zitadel/sdk-nuxt` module (which wires
 * the server-side proxy + session middleware), sets the login path, seeds
 * `runtimeConfig` with the backend URL, the proxy path, and the project id, and
 * marks the `zitadel-*` Lit elements as custom elements for the Vue compiler —
 * preserving the user's existing config via magicast. Idempotent. Throws
 * `E_VALIDATION` when the file is absent or `defineNuxtConfig` cannot be reached.
 */
export function nuxtConfigEdit(opts: {
  projectId: string;
  server: string;
}): (source: string | undefined) => string {
  return (source) => {
    const label = `the Nuxt config (${configPattern("nuxt.config")})`;
    const mod = parseConfigModule(source, label);
    const config = resolveDefaultExportObject(mod, label);

    ensureArrayItem(config, "modules", NUXT_MODULE);

    const nextgen = ensureEditableObject(config, "nextgen");
    if (nextgen.loginPath === undefined) {
      nextgen.loginPath = "/login";
    }

    const runtimeConfig = ensureEditableObject(config, "runtimeConfig");
    if (runtimeConfig.zitadelUrl === undefined) {
      runtimeConfig.zitadelUrl = builders.raw(
        `process.env.ZITADEL_URL ?? ${JSON.stringify(opts.server)}`,
      );
    }
    const publicConfig = ensureEditableObject(runtimeConfig, "public");
    if (publicConfig.nextgenProxyPath === undefined) {
      publicConfig.nextgenProxyPath = PROXY_PATH;
    }
    if (publicConfig.zitadelProjectId === undefined) {
      publicConfig.zitadelProjectId = builders.raw(
        `process.env.NUXT_PUBLIC_ZITADEL_PROJECT_ID ?? ${JSON.stringify(opts.projectId)}`,
      );
    }

    // The Lit components must be transpiled for SSR.
    const build = ensureEditableObject(config, "build");
    ensureArrayItem(build, "transpile", "@zitadel/api");
    ensureArrayItem(build, "transpile", "@zitadel/components");

    // Tell Vue's template compiler the `zitadel-*` Lit elements are custom
    // elements, not Vue components, so it renders them as native elements
    // instead of logging "Failed to resolve component" and mis-binding props.
    const vue = ensureEditableObject(config, "vue");
    const compilerOptions = ensureEditableObject(vue, "compilerOptions");
    if (compilerOptions.isCustomElement === undefined) {
      compilerOptions.isCustomElement = builders.raw(`(tag) => tag.startsWith("zitadel-")`);
    }

    const code = generateCode(mod).code;
    return code.endsWith("\n") ? code : `${code}\n`;
  };
}
