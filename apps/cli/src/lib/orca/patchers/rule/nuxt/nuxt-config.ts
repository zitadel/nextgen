import { builders, generateCode } from "magicast";

import {
  ensureArrayItem,
  ensureEditableObject,
  parseConfigModule,
  resolveDefaultExportObject,
} from "../utils/magicast";

const NUXT_MODULE = "@zitadel/sdk-nuxt/module";

/**
 * Builds the pure `edit` transform the file-writer applies to the project's Nuxt
 * config (`nuxt.config.*`): registers the `@zitadel/sdk-nuxt` module (which wires
 * the server-side proxy + session middleware), sets the login path, and seeds
 * `runtimeConfig` with the backend URL, the proxy path, and the project id —
 * preserving the user's existing config via magicast. Idempotent. Throws
 * `E_VALIDATION` when the file is absent or `defineNuxtConfig` cannot be reached.
 */
export function nuxtConfigEdit(opts: {
  projectId: string;
  server: string;
}): (source: string | undefined) => string {
  return (source) => {
    const mod = parseConfigModule(source, "the Nuxt config");
    const config = resolveDefaultExportObject(mod, "the Nuxt config");

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
      publicConfig.nextgenProxyPath = "/__nextgen";
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

    const code = generateCode(mod).code;
    return code.endsWith("\n") ? code : `${code}\n`;
  };
}
