import { builders, generateCode } from "magicast";

import { configCandidates, configPattern } from "./config-paths";
import type { FileOp } from "./file-writer/types";
import {
  ensureEditableObject,
  importIsPresent,
  parseConfigModule,
  resolveDefaultExportObject,
} from "./utils/magicast";
import { PROXY_PATH } from "./proxy";

/**
 * Shared Vite dev-server proxy merged into the project's Vite config for the SPA
 * frameworks (React, Vue). It forwards same-origin `/__nextgen/*` calls to the
 * backend, strips the prefix, and attaches the project's `sk_<project_id>`
 * bearer (read from `ZITADEL_PROJECT_ID` in the env) to every proxied request.
 */
function proxyEntryCode(server: string): string {
  return `{
  target: ${JSON.stringify(server)},
  changeOrigin: false,
  rewrite: (path) => path.replace(/^\\${PROXY_PATH}/, "").replace(/^(?!\\/)/, "/"),
  configure: (proxy) => {
    const projectId = loadEnv("development", dirname(fileURLToPath(import.meta.url)), "ZITADEL_").ZITADEL_PROJECT_ID;
    if (!projectId) {
      throw new Error("ZITADEL_PROJECT_ID is not set; add it to .env.local (zitadel setup writes it).");
    }
    const bearer = \`Bearer sk_\${projectId}\`;
    proxy.on("proxyReq", (proxyReq) => {
      proxyReq.setHeader("authorization", bearer);
    });
  },
}`;
}

/** The imports the injected proxy entry depends on. */
const PROXY_IMPORTS = [
  { from: "vite", imported: "loadEnv", local: "loadEnv" },
  { from: "node:url", imported: "fileURLToPath", local: "fileURLToPath" },
  { from: "node:path", imported: "dirname", local: "dirname" },
] as const;

/**
 * Builds the pure `edit` transform the file-writer applies to the project's Vite
 * config (`vite.config.*`): a non-destructive magicast merge that adds the
 * `/__nextgen` proxy and sets `server.host`/`server.port`/`strictPort` when they
 * are unset, preserving the user's plugins, options, and formatting. Idempotent
 * — entries already present are left as-is. Throws `E_VALIDATION` when the file
 * is absent or the config object cannot be reached (function-built/exotic
 * configs), with a hint to add the block manually.
 */
export function viteProxyEdit(
  devPort: number,
  server: string,
): (source: string | undefined) => string {
  return (source) => {
    const label = `the Vite config (${configPattern("vite.config")})`;
    const mod = parseConfigModule(source, label);
    const config = resolveDefaultExportObject(mod, label);
    const serverConfig = ensureEditableObject(config, "server");
    if (serverConfig.host === undefined) {
      serverConfig.host = "localhost";
    }
    if (serverConfig.port === undefined) {
      serverConfig.port = devPort;
    }
    if (serverConfig.strictPort === undefined) {
      serverConfig.strictPort = true;
    }
    const proxyConfig = ensureEditableObject(serverConfig, "proxy");
    if (proxyConfig[PROXY_PATH] === undefined) {
      proxyConfig[PROXY_PATH] = builders.raw(proxyEntryCode(server));
    }
    for (const imp of PROXY_IMPORTS) {
      if (!importIsPresent(mod, imp.local)) {
        mod.imports.$add({ ...imp });
      }
    }
    const code = generateCode(mod).code;
    return code.endsWith("\n") ? code : `${code}\n`;
  };
}

/**
 * Candidate Vite config filenames, in resolution priority. The patcher hands
 * this list to the generic `edit` file-op, which patches the first one that
 * exists — so any project layout (`vite.config.ts`, `.mts`, `.js`, …) is covered.
 */
export const VITE_CONFIG_PATHS = configCandidates("vite.config");

/**
 * Capability shared by every Vite-based patcher (React, Vue, and any future
 * Vite framework): contributes the file-op that non-destructively merges the
 * `/__nextgen` dev proxy into the project's Vite config. A patcher opts in by
 * declaring `implements ViteSupport` and spreading {@link viteProxyOp} into its
 * `routeOps`, so the proxy logic is written once and reused everywhere — no
 * per-framework duplication.
 */
export interface ViteSupport {
  /** The `edit` file-op that merges the `/__nextgen` proxy into the Vite config. */
  viteProxyOp(devPort: number, server: string): FileOp;
}

/** Builds the shared Vite-config proxy {@link FileOp} for a {@link ViteSupport} patcher. */
export function buildViteProxyOp(devPort: number, server: string): FileOp {
  return { kind: "edit", path: [...VITE_CONFIG_PATHS], edit: viteProxyEdit(devPort, server) };
}
