import { builders, generateCode, parseModule } from "magicast";

import { ZitadelError } from "../../../errors";

/**
 * Shared Vite dev-server proxy injected into `vite.config.ts` for the SPA
 * frameworks (React, Vue). It is a local-dev stand-in for `@zitadel/edge-proxy`:
 * it forwards same-origin `/__nextgen/*` calls to the backend (read from
 * `zitadel.json`), strips the prefix, and injects the project service-key bearer
 * on `POST /sessions/exchange` (read from the gitignored `.zitadel/secret`, so
 * the secret never enters source or the client bundle). Inserted verbatim as an
 * expression by magicast; the only symbol it needs is `readFileSync`.
 */

/** The proxy key the SDK widgets call same-origin (`configureZitadel({ proxyPath })`). */
export const PROXY_PATH = "/__nextgen";

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
          if (secret) proxyReq.setHeader("authorization", "Bearer " + secret);
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
export function viteProxyEdit(serverPort: number): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      throw new ZitadelError("E_VALIDATION", "Cannot merge Vite config: vite.config.ts not found", {
        hint: "Run setup from a Vite project, or create vite.config.ts first.",
      });
    }
    let mod: ReturnType<typeof parseModule>;
    try {
      mod = parseModule(source);
    } catch (error) {
      throw new ZitadelError("E_VALIDATION", "Could not parse vite.config.ts", {
        hint: "Ensure vite.config.ts is valid, or add the /__nextgen server.proxy block manually.",
        details: { cause: error instanceof Error ? error.message : String(error) },
      });
    }
    const config = resolveConfigObject(mod);
    if (config.server === undefined) config.server = {};
    if (config.server.host === undefined) config.server.host = "localhost";
    if (config.server.port === undefined) config.server.port = serverPort;
    if (config.server.proxy === undefined) config.server.proxy = {};
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
 * Reaches the config object literal in a Vite config module — the argument of
 * `export default defineConfig({...})` or a bare `export default {...}`. Throws
 * `E_VALIDATION` for shapes magicast cannot safely edit (function-form configs,
 * configs built elsewhere) so the patcher can fall back to manual steps.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveConfigObject(mod: any): any {
  const def = mod.exports?.default;
  const unreachable = () =>
    new ZitadelError("E_VALIDATION", "Could not locate the config object in vite.config.ts", {
      hint: 'Add a server.proxy["/__nextgen"] entry manually (see the SDK README).',
    });
  if (!def) throw unreachable();
  if (def.$type === "function-call") {
    const arg = def.$args?.[0];
    if (!arg || arg.$type !== "object") throw unreachable();
    return arg;
  }
  if (def.$type === "object") return def;
  throw unreachable();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function importIsPresent(mod: any, local: string): boolean {
  try {
    const items: ReadonlyArray<{ local?: string }> = mod.imports?.$items ?? [];
    return items.some((item) => item.local === local);
  } catch {
    return false;
  }
}
