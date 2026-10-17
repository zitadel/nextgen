import { builders, generateCode } from "magicast";

import { configCandidates } from "./config-paths";
import type { FileOp } from "./file-writer/types";
import { PROXY_PATH } from "./proxy";
import {
  assertNoUnreviewedProjectSecretProxy,
  EXCHANGE_REDACTION_MARKER,
  EXCHANGE_REDACTION_ZLIB,
  entryText,
  exchangeRedactionFunctions,
  hasResponseHook,
  PROXY_CREDENTIAL_POLICY_MARKER,
  upgradeExchangeRedaction,
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
 *
 * The backend is addressed by its own name: `changeOrigin` sends the target's
 * host as `Host`, which Node also uses as the TLS server name and for the
 * certificate check, so a remote https server accepts the connection — and one
 * behind a shared edge such as Vercel, which routes by `Host`, finds the
 * deployment. The app's own origin travels in `X-Forwarded-Host` and
 * `X-Forwarded-Proto` (`xfwd`), which the server reads before `Host`, as the
 * Next and Nuxt middleware send it. The WebAuthn relying party comes from the
 * browser's `Origin`, which the proxy passes on untouched.
 *
 * The exchange's response carries the HttpOnly session token in its body, so
 * the proxy handles responses itself (`selfHandleResponse`) and drops the token
 * from that one body; see {@link exchangeRedactionFunctions}.
 */
function proxyEntryCode(server: string, typed: boolean): string {
  return `/* ${PROXY_CREDENTIAL_POLICY_MARKER} */ {
  target: ${JSON.stringify(server)},
  selfHandleResponse: true,
  changeOrigin: true,
  xfwd: true,
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
${exchangeRedactionCode("    ", typed)}
  },
}`;
}

/**
 * The redaction functions of {@link exchangeRedactionFunctions} and the two
 * listeners that use them, as statements inside the entry's `configure`.
 */
function exchangeRedactionCode(indent: string, typed: boolean): string {
  return `${exchangeRedactionFunctions(indent, typed)}
${indent}proxy.on("proxyReq", requestPlainExchange);
${indent}proxy.on("proxyRes", relayResponse);`;
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
  return (
    [
      'loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_PROJECT_SECRET',
      'throw new Error("ZITADEL_PROJECT_SECRET is not set; add it to .env.local (zitadel setup writes it).")',
      "const bearer = `Bearer ${secret}`;",
    ].every((fingerprint) => source.includes(fingerprint)) &&
    LEGACY_PROXY_REQUEST_LISTENER.test(source)
  );
}

/**
 * The generated entry as emitted before it forwarded the app's origin:
 * `changeOrigin: false` straight after `target`. Keeping the browser's `Host`
 * also kept `localhost` as the TLS server name, so that proxy could reach no
 * remote https server.
 */
const HOST_KEEPING_ENTRY =
  /(["']\/__nextgen["']:\s*(?:\/\* zitadel:proxy:v2 \*\/\s*)?\{\r?\n([\t ]+)target: [^\r\n]+,\r?\n)\2changeOrigin: false,(\r?\n)/;

/**
 * Moves the CLI's own host-keeping entry to the origin-forwarding shape of
 * {@link proxyEntryCode}. Only the generated layout in a config that carries
 * the credential-policy marker qualifies, and a config that already sets
 * `xfwd` has made its own forwarding choice: a hand-written `/__nextgen` entry
 * is never touched.
 */
function forwardAppOrigin(source: string): string {
  if (!source.includes(PROXY_CREDENTIAL_POLICY_MARKER) || /\bxfwd\s*:/.test(source)) {
    return source;
  }
  return source.replace(
    HOST_KEEPING_ENTRY,
    (_entry, head: string, indent: string, eol: string) =>
      `${head}${indent}changeOrigin: true,${eol}${indent}xfwd: true,${eol}`,
  );
}

/** Escapes `text` for use as a literal inside a regular expression. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * The generated exchange-only bearer listener, at any indent (captured as
 * group 1), with any line ending.
 */
const EXCHANGE_ONLY_LISTENER = new RegExp(
  `(^[\\t ]*)${exchangeOnlyProxyRequestListener("")
    .split("\n")
    .slice(1)
    .map(literal)
    .join("\\r?\\n\\1")}`,
  "m",
);

/**
 * The head of the generated `/__nextgen` entry up to its `target` line; group
 * 2 is the entry's indent and group 3 its line ending.
 */
const GENERATED_ENTRY_HEAD =
  /(["']\/__nextgen["']:\s*(?:\/\* zitadel:proxy:v2 \*\/\s*)?\{(\r?\n)([\t ]+)target: [^\r\n]+,\r?\n)/;

/**
 * Adds the session-token redaction to the generated entry written before it
 * existed: `selfHandleResponse` after `target`, and the redaction code after
 * the generated bearer listener. Both anchors must be the CLI's own bytes —
 * a response handler without `selfHandleResponse`, or the reverse, would break
 * every proxied call — so an entry changed by hand, or one that already made
 * its own `selfHandleResponse` choice, is left alone.
 */
function redactExchange(source: string, typed: boolean): string {
  const head = GENERATED_ENTRY_HEAD.exec(source);
  if (
    !source.includes(PROXY_CREDENTIAL_POLICY_MARKER) ||
    source.includes(EXCHANGE_REDACTION_MARKER) ||
    head === null ||
    // Only the Zitadel entry's own choice counts: a sibling proxy may set it.
    /\bselfHandleResponse\b/.test(entryText(source, head.index)) ||
    // A hook of the project's own would run after the headers were sent.
    hasResponseHook(entryText(source, head.index)) ||
    !EXCHANGE_ONLY_LISTENER.test(source)
  ) {
    return source;
  }
  return source
    .replace(
      GENERATED_ENTRY_HEAD,
      (_head, head: string, eol: string, indent: string) =>
        `${head}${indent}selfHandleResponse: true,${eol}`,
    )
    .replace(EXCHANGE_ONLY_LISTENER, (listener: string, indent: string) => {
      const eol = listener.includes("\r\n") ? "\r\n" : "\n";
      return `${listener}${eol}${exchangeRedactionCode(indent, typed).replace(/\n/g, eol)}`;
    });
}

/** A position in a parsed file, as the parser reports it: a 1-based line and a column. */
interface AstPosition {
  line: number;
  column: number;
}

/**
 * The offset in `source` of a parser position. The parser reads the file with
 * its line endings normalised, so its own offsets drift by a byte for every
 * CRLF before the position; line and column do not.
 */
function offsetOf(source: string, position: AstPosition): number {
  let offset = 0;
  for (let line = 1; line < position.line; line += 1) {
    const next = source.indexOf("\n", offset);
    if (next === -1) {
      return source.length;
    }
    offset = next + 1;
  }
  return offset + position.column;
}

/**
 * The span of the config's `server.proxy` object literal, or `undefined` when
 * the config has none that can be read as one.
 */
function proxyTableRange(
  config: ReturnType<typeof resolveDefaultExportObject>,
  source: string,
): { start: number; end: number } | undefined {
  const server = (config as Record<string, unknown>).server as Record<string, unknown> | undefined;
  const table = server?.proxy as
    | { $ast?: { type?: string; loc?: { start?: AstPosition; end?: AstPosition } } }
    | undefined;
  const node = table?.$ast;
  if (node?.type !== "ObjectExpression" || !node.loc?.start || !node.loc.end) {
    return undefined;
  }
  const start = offsetOf(source, node.loc.start);
  const end = offsetOf(source, node.loc.end);
  return source[start] === "{" && source[end - 1] === "}" ? { start, end } : undefined;
}

/**
 * Moves the generated `/__nextgen` entry in the dev server's proxy table onto
 * its current shape: the bearer listener, the origin forwarding and the
 * session-token redaction.
 */
function migrateProxyTable(table: string, typed: boolean): string {
  let migrated = table;
  if (isLegacyManagedProxy(migrated)) {
    // Replace only the generated bearer listener. User changes elsewhere in
    // the proxy entry (target, rewrite, TLS options, comments) remain intact.
    migrated = migrated.replace(LEGACY_PROXY_REQUEST_LISTENER, (_listener, indent: string) =>
      exchangeOnlyProxyRequestListener(indent),
    );
  }
  return redactExchange(
    forwardAppOrigin(
      upgradeExchangeRedaction(migrated, (indent) => exchangeRedactionFunctions(indent, typed)),
    ),
    typed,
  );
}

/** The imports that the injected proxy entry depends on. */
const PROXY_IMPORTS = [{ from: "vite", imported: "loadEnv", local: "loadEnv" }] as const;

/** The import the generated session-token redaction decodes with. */
const REDACTION_IMPORTS = [
  { from: "node:zlib", imported: "default", local: EXCHANGE_REDACTION_ZLIB },
] as const;

/**
 * Builds the pure `edit` transform the file-writer applies to the project's Vite
 * config (`vite.config.*`): a non-destructive magicast merge that adds the
 * `/__nextgen` proxy and sets `server.port`/`strictPort` when they are unset,
 * preserving the user's plugins, options, and formatting. Leaves `server.host`
 * alone so the user can still opt into network binding (`--host`/`host: true`);
 * the issuer/origin requirement is about the port, not the bind host. Idempotent
 * — entries already present are left as-is, except the CLI's own earlier proxy
 * shapes, which are migrated in place: the unconditional bearer listener, the
 * host-keeping entry, the entry without the session-token redaction, and the
 * redaction that relayed a compressed exchange answer unread. Throws `E_VALIDATION` when the file is absent or the
 * config object cannot be reached (function-built/exotic configs), with a hint
 * to add the block manually.
 */
export function viteProxyEdit(
  devPort: number,
  server: string,
): (source: string | undefined, path?: string) => string {
  return (source, path) => {
    const typed = path !== undefined && /\.[cm]?ts$/.test(path);
    const label = "the Vite config (vite.config.*)";
    let workingSource = source;
    // Only the dev server's own proxy table is migrated. `preview.proxy` or
    // any other config object may hold copies of the entry; those are not the
    // ones the dev server runs, and a marker in one must not hide the other.
    const original = parseConfigModule(source, label);
    const table = proxyTableRange(resolveDefaultExportObject(original, label), source ?? "");
    let devTable: string | undefined;
    if (source !== undefined && table !== undefined) {
      devTable = migrateProxyTable(source.slice(table.start, table.end), typed);
      workingSource = source.slice(0, table.start) + devTable + source.slice(table.end);
    }
    if (source !== undefined && !isLegacyManagedProxy(source.slice(table?.start, table?.end))) {
      assertNoUnreviewedProjectSecretProxy(source, label);
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
    const redacting =
      proxyConfig[PROXY_PATH] === undefined ||
      devTable?.includes(EXCHANGE_REDACTION_MARKER) === true;
    if (proxyConfig[PROXY_PATH] === undefined) {
      proxyConfig[PROXY_PATH] = builders.raw(proxyEntryCode(server, typed));
      changed = true;
    }
    for (const imp of redacting ? [...PROXY_IMPORTS, ...REDACTION_IMPORTS] : PROXY_IMPORTS) {
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
