import { builders, generateCode } from "magicast";

import { configCandidates } from "./config-paths";
import type { FileOp } from "./file-writer/types";
import { importIsPresent, parseConfigModule, resolveDefaultExportObject } from "./utils/magicast";
import { PROXY_PATH } from "./proxy";

/**
 * Shared Vite dev-server proxy injected into `vite.config.ts` for the SPA
 * frameworks (React, Vue). It is a local-dev stand-in for `@zitadel/edge-proxy`:
 * it forwards same-origin `/__nextgen/*` calls to the backend (read from
 * `zitadel.json`), strips the prefix, and injects the project service-key bearer
 * on `POST /sessions/exchange` (read from the gitignored `.zitadel/secret`, so
 * the secret never enters source or the client bundle). Inserted verbatim as an
 * expression by magicast; the only symbol it needs is `readFileSync`.
 */

/** Raw source for the `server.proxy["/__nextgen"]` entry. */
export const PROXY_ENTRY_CODE = `{
  target: (() => {
    try {
      return JSON.parse(readFileSync("zitadel.json", "utf8")).server ?? "http://localhost:8080";
    } catch {
      return "http://localhost:8080";
    }
  })(),
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\\/__nextgen/, ""),
  configure: (proxy) => {
    proxy.on("proxyReq", (proxyReq, req) => {
      if (req.method === "POST" && String(req.url ?? "").includes("/sessions/exchange")) {
        try {
          const secret = JSON.parse(readFileSync(".zitadel/secret", "utf8")).project_secret;
          if (secret) {
            proxyReq.setHeader("authorization", "Bearer " + secret);
          }
        } catch {
          // secret not provisioned yet — leave the request unauthenticated
        }
      }
    });
  },
}`;

/** The import the injected proxy entry depends on. */
export const PROXY_IMPORT = {
  from: "node:fs",
  imported: "readFileSync",
  local: "readFileSync",
} as const;

/**
 * Builds the pure `edit` transform that the file-writer applies to the user's
 * `vite.config.ts`: a non-destructive magicast merge that adds the `/__nextgen`
 * proxy (and pins `server.host`/`server.port` to the issuer the CLI derived),
 * preserving the user's plugins, options, and formatting. Idempotent — entries
 * already present are left as-is. Throws `E_VALIDATION` when the file is absent
 * or the config object cannot be reached (function-built/exotic configs), with a
 * hint to add the block manually.
 */
export function viteProxyEdit(devPort: number): (source: string | undefined) => string {
  return (source) => {
    const mod = parseConfigModule(source, "vite.config.ts");
    const config = resolveDefaultExportObject(mod, "vite.config.ts");
    if (config.server === undefined) {
      config.server = {};
    }
    if (config.server.host === undefined) {
      config.server.host = "localhost";
    }
    if (config.server.port === undefined) {
      config.server.port = devPort;
    }
    if (config.server.proxy === undefined) {
      config.server.proxy = {};
    }
    if (config.server.proxy[PROXY_PATH] === undefined) {
      config.server.proxy[PROXY_PATH] = builders.raw(PROXY_ENTRY_CODE);
    }
    if (!importIsPresent(mod, PROXY_IMPORT.local)) {
      mod.imports.$add({ ...PROXY_IMPORT });
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
  viteProxyOp(devPort: number): FileOp;
}

/** Builds the shared Vite-config proxy {@link FileOp} for a {@link ViteSupport} patcher. */
export function buildViteProxyOp(devPort: number): FileOp {
  return { kind: "edit", path: [...VITE_CONFIG_PATHS], edit: viteProxyEdit(devPort) };
}
