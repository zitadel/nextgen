import { builders, generateCode } from "magicast";

import { configCandidates } from "./config-paths";
import type { FileOp } from "./file-writer/types";
import { PROXY_PATH } from "./proxy";
import {
  assertNoUnreviewedProjectSecretProxy,
  PROXY_CREDENTIAL_POLICY_MARKER,
} from "./proxy-credential-policy";
import {
  ensureEditableObject,
  importIsPresent,
  parseConfigModule,
  resolveDefaultExportObject,
} from "./utils/magicast";

/**
 * Shared Vite dev-server proxy merged into the project's Vite config for the SPA
 * frameworks (React, Vue, Solid, Svelte, Qwik). It forwards same-origin
 * `/__nextgen/*` calls to the
 * backend, strips the prefix, and attaches the project's service-key secret
 * (read from `ZITADEL_PROJECT_SECRET` in `.env.local`) only to the current
 * app-plane `POST /sessions/exchange` operation. The secret stays server-side:
 * Vite only exposes vars with the configured `envPrefix` (default `VITE_`) to
 * client bundles, so this server-only key never leaks into the browser.
 */
function proxyEntryCode(server: string): string {
  return `/* ${PROXY_CREDENTIAL_POLICY_MARKER} */ {
  target: ${JSON.stringify(server)},
  changeOrigin: false,
  rewrite: (path) => path.replace(/^\\${PROXY_PATH}/, "").replace(/^(?!\\/)/, "/"),
  configure: (proxy) => {
    const secret = loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_PROJECT_SECRET;
    if (!secret) {
      throw new Error("ZITADEL_PROJECT_SECRET is not set; add it to .env.local (zitadel setup writes it).");
    }
    const bearer = \`Bearer \${secret}\`;
    proxy.on("proxyReq", (proxyReq) => {
      const pathname = new URL(proxyReq.path, "http://zitadel.local").pathname;
      if (
        proxyReq.method === "POST" &&
        pathname === "/sessions/exchange" &&
        !proxyReq.getHeader("authorization")
      ) {
        proxyReq.setHeader("authorization", bearer);
      }
    });
  },
}`;
}

const LEGACY_PROXY_REQUEST_LISTENER =
  /(^[\t ]*)proxy\.on\("proxyReq", \(proxyReq\) => \{\r?\n\1 {2}proxyReq\.setHeader\("authorization", bearer\);\r?\n\1\}\);/m;

function exchangeOnlyProxyRequestListener(indent: string): string {
  return `${indent}/* ${PROXY_CREDENTIAL_POLICY_MARKER} */
${indent}proxy.on("proxyReq", (proxyReq) => {
${indent}  const pathname = new URL(proxyReq.path, "http://zitadel.local").pathname;
${indent}  if (
${indent}    proxyReq.method === "POST" &&
${indent}    pathname === "/sessions/exchange" &&
${indent}    !proxyReq.getHeader("authorization")
${indent}  ) {
${indent}    proxyReq.setHeader("authorization", bearer);
${indent}  }
${indent}});`;
}

/**
 * Identifies the exact proxy shape emitted before the exchange-only credential
 * policy. Setup may replace that generated listener, but must preserve the
 * surrounding `/__nextgen` proxy and any user changes elsewhere in the entry.
 */
function isLegacyManagedProxy(source: string): boolean {
  if (source.includes(PROXY_CREDENTIAL_POLICY_MARKER)) {
    return false;
  }
  return [
    'loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_PROJECT_SECRET',
    'throw new Error("ZITADEL_PROJECT_SECRET is not set; add it to .env.local (zitadel setup writes it).")',
    "const bearer = `Bearer ${secret}`;",
  ].every((fingerprint) => source.includes(fingerprint)) && LEGACY_PROXY_REQUEST_LISTENER.test(source);
}

/** The imports that the injected proxy entry depends on. */
const PROXY_IMPORTS = [{ from: "vite", imported: "loadEnv", local: "loadEnv" }] as const;

/**
 * Builds the pure `edit` transform the file-writer applies to the project's Vite
 * config (`vite.config.*`): a non-destructive magicast merge that adds the
 * `/__nextgen` proxy and sets `server.port`/`strictPort` when they are unset,
 * preserving the user's plugins, options, and formatting. Leaves `server.host`
 * alone so the user can still opt into network binding (`--host`/`host: true`);
 * the issuer/origin requirement is about the port, not the bind host. Idempotent
 * — entries already present are left as-is. Throws `E_VALIDATION` when the file
 * is absent or the config object cannot be reached (function-built/exotic
 * configs), with a hint to add the block manually.
 */
export function viteProxyEdit(
  devPort: number,
  server: string,
): (source: string | undefined) => string {
  return (source) => {
    const label = "the Vite config (vite.config.*)";
    let workingSource = source;
    if (workingSource !== undefined && isLegacyManagedProxy(workingSource)) {
      // Replace only the generated bearer listener. User changes elsewhere in
      // the proxy entry (target, rewrite, TLS options, comments) remain intact.
      workingSource = workingSource.replace(
        LEGACY_PROXY_REQUEST_LISTENER,
        (_listener, indent: string) => exchangeOnlyProxyRequestListener(indent),
      );
    } else if (workingSource !== undefined) {
      assertNoUnreviewedProjectSecretProxy(workingSource, label);
    }

    const mod = parseConfigModule(workingSource, label);
    const config = resolveDefaultExportObject(mod, label);
    let changed = workingSource !== source;
    const serverConfig = ensureEditableObject(config, "server");
    if (serverConfig.port === undefined) {
      serverConfig.port = devPort;
      changed = true;
    }
    if (serverConfig.strictPort === undefined) {
      serverConfig.strictPort = true;
      changed = true;
    }
    const proxyConfig = ensureEditableObject(serverConfig, "proxy");
    if (proxyConfig[PROXY_PATH] === undefined) {
      proxyConfig[PROXY_PATH] = builders.raw(proxyEntryCode(server));
      changed = true;
    }
    for (const imp of PROXY_IMPORTS) {
      if (!importIsPresent(mod, imp.local, imp.from)) {
        mod.imports.$add({ ...imp });
        changed = true;
      }
    }
    // Nothing was missing — return the source untouched so the file-writer skips
    // it instead of letting magicast reformat an already-patched config.
    if (!changed && source !== undefined) {
      return source;
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
  return {
    kind: "edit",
    path: [...VITE_CONFIG_PATHS],
    edit: viteProxyEdit(devPort, server),
    // The dev proxy is the auth request path — the doctor managed-files
    // check fails when this merge is no longer applied.
    wiring: "infrastructure",
  };
}
