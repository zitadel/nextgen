import { builders, generateCode, parseModule } from "magicast";

import { ZitadelError } from "../../../../errors";
import { ensureArrayItem, ensureEditableObject, resolveDefaultExportObject } from "../magicast-config";

const NUXT_MODULE = "@zitadel/sdk-nuxt/module";

/**
 * Builds the pure `edit` transform the file-writer applies to `nuxt.config.ts`:
 * registers the `@zitadel/sdk-nuxt` module (which wires the server-side proxy +
 * session middleware), sets the login path, and seeds `runtimeConfig` with the
 * backend URL, the proxy path, and the project id — preserving the user's
 * existing config via magicast. Idempotent. Throws `E_VALIDATION` when the file
 * is absent or `defineNuxtConfig` cannot be reached.
 */
export function nuxtConfigEdit(opts: {
  projectId: string;
  server: string;
}): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      throw new ZitadelError("E_VALIDATION", "Cannot edit Nuxt config: nuxt.config.ts not found", {
        hint: "Run setup from a Nuxt project.",
      });
    }
    let mod: ReturnType<typeof parseModule>;
    try {
      mod = parseModule(source);
    } catch (error) {
      throw new ZitadelError("E_VALIDATION", "Could not parse nuxt.config.ts", {
        hint: "Ensure nuxt.config.ts is valid, or add the @zitadel/sdk-nuxt config manually.",
        details: { cause: error instanceof Error ? error.message : String(error) },
      });
    }
    const config = resolveDefaultExportObject(mod, "nuxt.config.ts");

    ensureArrayItem(config, "modules", NUXT_MODULE);

    if (config.nextgen === undefined) {
      config.nextgen = { loginPath: "/login" };
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
