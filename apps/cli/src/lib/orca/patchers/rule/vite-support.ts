import { builders } from "magicast";

import { configCandidates } from "./config-paths";
import type { DevelopmentServerUrl } from "@/lib/orca/patchers/types";
import type { FileOp, WiringVerdict } from "./file-writer/types";
import { PROXY_PATH } from "./proxy";
import {
  assertNoUnreviewedProjectSecretProxy,
  EXCHANGE_PATH_CHECK,
  hasProxyCredentialPolicyMarker,
  PROXY_ADDRESS_MARKER,
  PROXY_CREDENTIAL_POLICY_MARKER,
  PREFIXED_EXCHANGE_PATH,
  PROXY_CREDENTIAL_POLICY_V2_MARKER,
  V2_EXCHANGE_PATH_CHECK,
} from "./proxy-credential-policy";
import {
  indented,
  SESSION_COOKIE_MARKER,
  SESSION_COOKIE_MARKER_V1,
  viteSessionCookieStatements,
  viteSessionCookieStatementsV1,
} from "./session-cookie";
import { lfText, withLfLineEnds } from "./utils/line-ends";
import { ConfigModule } from "./utils/config-module";

/**
 * Shared Vite dev-server proxy merged into the project's Vite config for the SPA
 * frameworks (React, Vue, Solid, Svelte, Qwik). It forwards same-origin
 * `/__nextgen/*` calls to the
 * backend, strips the prefix, and attaches the project's service-key secret
 * (`ZITADEL_PROJECT_SECRET`) only to the current
 * app-plane `POST /sessions/exchange` operation, which it knows with and
 * without the API prefix (`/api/v1`, ADR 077). The secret stays server-side:
 * Vite only exposes vars with the configured `envPrefix` (default `VITE_`) to
 * client bundles, so this server-only key never leaks into the browser.
 *
 * Both values are read with Vite's `loadEnv`: the process environment first,
 * then Vite's development env files, `.env.development.local` first, then
 * `.env.development`, `.env.local` and `.env`. The backend's address is
 * `ZITADEL_URL`, and the address setup ran against is the fallback, so a test
 * run can point the app at its own server and an app without the variable
 * keeps working ({@link serverAddress}).
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
 * The session cookie travels under the app's project's name in the browser and
 * the server's name upstream ({@link viteSessionCookieStatements}, ADR 073,
 * ADR 083).
 */
function proxyEntryCode(server: string): string {
  return `/* ${PROXY_ADDRESS_MARKER} */ {
  target: ${indentedTail(serverAddress(server), "  ")},
  changeOrigin: true,
  xfwd: true,
  rewrite: (path) => path.replace(/^\\${PROXY_PATH}/, "").replace(/^(?!\\/)/, "/"),
  configure: (proxy) => {
    const secret = loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_PROJECT_SECRET;
    if (!secret) {
      throw new Error("ZITADEL_PROJECT_SECRET is not set; add it to .env.local (zitadel setup writes it).");
    }
    const bearer = \`Bearer \${secret}\`;
${bearerListener("    ")}
${indented(viteSessionCookieStatements(), "    ")}
  },
}`;
}

/**
 * The generated proxy's `target`: `ZITADEL_URL` as Vite loads it, or
 * `fallback`, the address setup wrote. An empty value counts as none, and it
 * hides the sources below it: an empty `ZITADEL_URL` in the process
 * environment skips the env files and lands on the fallback. The address is
 * reduced to its origin, as the CLI reads one everywhere else, since the
 * proxy forwards under a path and the bearer hook matches the bare exchange.
 * One that is no http(s) URL fails, naming the variable, rather than starting
 * a proxy that answers 502. It runs when the config loads.
 *
 * Its text is how {@link viteServerAddressVerdict} knows the proxy as setup's:
 * a change to it must keep recognising the text released before.
 */
function serverAddress(fallback: string): string {
  return `((url) => {
  if (!URL.canParse(url) || !["http:", "https:"].includes(new URL(url).protocol)) {
    throw new Error(\`ZITADEL_URL is not an http(s) URL: \${url}\`);
  }
  return new URL(url).origin;
})(loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_URL || ${JSON.stringify(fallback)})`;
}

/** `code` with every line but its first indented by `indent`. */
function indentedTail(code: string, indent: string): string {
  return code.replace(/\n/g, `\n${indent}`);
}

/**
 * The generated hook that attaches the project secret to the session exchange
 * only. `pathCheck` is the exchange's path test: both spellings, or the one a
 * v2 proxy knew.
 */
function bearerListener(indent: string, pathCheck = EXCHANGE_PATH_CHECK): string {
  return `${indent}proxy.on("proxyReq", (proxyReq) => {
${indent}  const pathname = new URL(proxyReq.path, "http://zitadel.local").pathname;
${indent}  if (
${indent}    proxyReq.method === "POST" &&
${indent}    ${pathCheck} &&
${indent}    !proxyReq.getHeader("authorization")
${indent}  ) {
${indent}    proxyReq.setHeader("authorization", bearer);
${indent}  }
${indent}});`;
}

const LEGACY_PROXY_REQUEST_LISTENER =
  /(^[\t ]*)proxy\.on\("proxyReq", \(proxyReq\) => \{\r?\n\1 {2}proxyReq\.setHeader\("authorization", bearer\);\r?\n\1\}\);/m;

function exchangeOnlyProxyRequestListener(indent: string): string {
  return `${indent}/* ${PROXY_CREDENTIAL_POLICY_MARKER} */
${bearerListener(indent)}`;
}

/**
 * Identifies the exact proxy shape emitted before the exchange-only credential
 * policy. Setup may replace that generated listener, but must preserve the
 * surrounding `/__nextgen` proxy and any user changes elsewhere in the entry.
 */
function isLegacyManagedProxy(source: string): boolean {
  if (hasProxyCredentialPolicyMarker(source)) {
    return false;
  }
  return (
    [
      'loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_PROJECT_SECRET',
      'throw new Error("ZITADEL_PROJECT_SECRET is not set; add it to .env.local (zitadel setup writes it).")',
      "const bearer = `Bearer ${secret}`;",
    ].every((fingerprint) => {
      return source.includes(fingerprint);
    }) && LEGACY_PROXY_REQUEST_LISTENER.test(source)
  );
}

/**
 * The generated entry as emitted before it forwarded the app's origin:
 * `changeOrigin: false` straight after `target`. Keeping the browser's `Host`
 * also kept `localhost` as the TLS server name, so that proxy could reach no
 * remote https server.
 */
const HOST_KEEPING_ENTRY =
  /(["']\/__nextgen["']:\s*(?:\/\* zitadel:proxy:v[23] \*\/\s*)?\{\r?\n([\t ]+)target: [^\r\n]+,\r?\n)\2changeOrigin: false,(\r?\n)/;

/**
 * Moves the CLI's own host-keeping entry to the origin-forwarding shape of
 * {@link proxyEntryCode}. Only the generated layout in a config that carries
 * the credential-policy marker qualifies, and a config that already sets
 * `xfwd` has made its own forwarding choice: a hand-written `/__nextgen` entry
 * is never touched.
 */
function forwardAppOrigin(source: string): string {
  if (!hasProxyCredentialPolicyMarker(source) || /\bxfwd\s*:/.test(source)) {
    return source;
  }
  return source.replace(HOST_KEEPING_ENTRY, (_entry, head: string, indent: string, eol: string) => {
    return `${head}${indent}changeOrigin: true,${eol}${indent}xfwd: true,${eol}`;
  });
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
 * — entries already present are left as-is, except the CLI's own earlier proxy
 * shapes, which are migrated in place: the unconditional bearer listener and
 * the host-keeping entry. Throws `E_VALIDATION` when the file is absent or the
 * config object cannot be reached (function-built/exotic configs), with a hint
 * to add the block manually.
 *
 * `previousPort` moves the app: a `server.port` still on that port is
 * rewritten to `devPort`, while any other pinned port stays the user's.
 */
export function viteProxyEdit(
  devPort: number,
  server: string,
  previousPort?: number,
): (source: string | undefined) => string {
  return (source) => {
    const label = "the Vite config (vite.config.*)";
    if (source !== undefined && !isLegacyManagedProxy(source)) {
      assertNoUnreviewedProjectSecretProxy(source, label);
    }
    // Replace only the generated bearer listener. User changes elsewhere in
    // the proxy entry (target, rewrite, TLS options, comments) remain intact.
    const migrated =
      source !== undefined && isLegacyManagedProxy(source)
        ? source.replace(LEGACY_PROXY_REQUEST_LISTENER, (_listener, indent: string) => {
            return exchangeOnlyProxyRequestListener(indent);
          })
        : source;
    const workingSource = migrated === undefined ? undefined : forwardAppOrigin(migrated);

    const file = ConfigModule.open(workingSource, label);
    const config = file.exportedObject();
    config.server ??= {};
    const serverConfig = file.objectAt(config, "server");
    const movesPort =
      serverConfig.port === undefined ||
      (previousPort !== undefined &&
        serverConfig.port === previousPort &&
        devPort !== previousPort);
    if (movesPort) {
      serverConfig.port = devPort;
    }
    const pinsStrictPort = serverConfig.strictPort === undefined;
    if (pinsStrictPort) {
      serverConfig.strictPort = true;
    }
    serverConfig.proxy ??= {};
    const proxyConfig = file.objectAt(serverConfig, "proxy");
    const addsProxy = proxyConfig[PROXY_PATH] === undefined;
    if (addsProxy) {
      proxyConfig[PROXY_PATH] = builders.raw(proxyEntryCode(server));
    }
    const missingImports = PROXY_IMPORTS.filter((imp) => {
      return !file.module.imports.$items.some((item) => {
        return item.local === imp.local && item.from === imp.from;
      });
    });
    for (const imp of missingImports) {
      file.module.imports.$add({ ...imp });
    }
    const changed =
      workingSource !== source ||
      movesPort ||
      pinsStrictPort ||
      addsProxy ||
      missingImports.length > 0;
    // Nothing was missing — return the source untouched so the file-writer skips
    // it instead of letting magicast reformat an already-patched config.
    return file.render(changed);
  };
}

/** The slice of a babel AST node {@link cliEntryOf} walks. */
interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  /** An object property's key: an identifier's `name`, a string literal's `value`. */
  readonly key?: { readonly name?: string; readonly value?: unknown };
  readonly value?: AstNode;
  readonly body?: AstNode | ReadonlyArray<AstNode>;
  readonly properties?: ReadonlyArray<AstNode>;
}

/** The property `name` of an object literal node, if it has one. */
function propertyOf(node: AstNode | undefined, name: string): AstNode | undefined {
  return node?.properties?.find((property) => {
    return (
      (property.type === "ObjectProperty" || property.type === "ObjectMethod") &&
      (property.key?.name === name || property.key?.value === name)
    );
  });
}

/**
 * `source` as the tokens a formatter leaves alone, so Prettier's or Biome's
 * layout of what the CLI wrote still matches it: no whitespace, semicolons or
 * trailing commas, double quotes, and a lone arrow-function parameter in
 * parentheses.
 */
function fingerprint(source: string): string {
  return source
    .replace(/\s+/g, "")
    .replace(/'/g, '"')
    .replace(/;/g, "")
    .replace(/,(?=[)\]}])/g, "")
    .replace(/(^|[(,:=])([A-Za-z_$][\w$]*)=>/g, "$1($2)=>");
}

/** The `/__nextgen` entry the CLI wrote, found in a config's syntax tree. */
interface CliEntry {
  /** The entry's property: its key, the marker and the object literal the CLI wrote. */
  readonly entry: AstNode;
  /** The statements of its `configure(proxy)` body. */
  readonly statements: ReadonlyArray<AstNode>;
  /**
   * The bearer hook among them, and whether it knows the API prefix (`v3`) or
   * only the unprefixed exchange (`v2`).
   */
  readonly hook: { readonly node: AstNode; readonly version: "v2" | "v3" };
}

/** The bearer hook as the CLI writes it now, and as a v2 proxy carries it, fingerprinted. */
const HOOK_FINGERPRINTS = [
  { version: "v3", fingerprint: fingerprint(bearerListener("")) },
  { version: "v2", fingerprint: fingerprint(bearerListener("", V2_EXCHANGE_PATH_CHECK)) },
] as const;

/**
 * The `/__nextgen` entry the CLI wrote: one carrying the credential-policy
 * marker and the CLI's own exchange-only bearer hook, of either version,
 * however it was formatted since. A hand-written entry, or one whose hook was
 * changed, yields `undefined`.
 */
function cliEntryOf(config: unknown, source: string): CliEntry | undefined {
  const entry = markedEntryOf(config, source);
  const configure = propertyOf(entry?.value, "configure");
  const fn = configure?.type === "ObjectMethod" ? configure : configure?.value;
  const body = fn?.body;
  if (!entry || !body || Array.isArray(body) || (body as AstNode).type !== "BlockStatement") {
    return undefined;
  }
  const statements = (body as AstNode).body as ReadonlyArray<AstNode>;
  for (const node of statements) {
    const printed = fingerprint(source.slice(node.start, node.end));
    const known = HOOK_FINGERPRINTS.find((hook) => {
      return hook.fingerprint === printed;
    });
    if (known) {
      return { entry, statements, hook: { node, version: known.version } };
    }
  }
  return undefined;
}

/**
 * The `/__nextgen` entry carrying the credential-policy marker, which setup
 * wrote, whatever was changed in it since; `undefined` without one.
 */
function markedEntryOf(config: unknown, source: string): AstNode | undefined {
  const root = (config as { $ast?: AstNode }).$ast;
  const proxy = propertyOf(propertyOf(root, "server")?.value, "proxy")?.value;
  const entry = propertyOf(proxy, PROXY_PATH);
  return entry && hasProxyCredentialPolicyMarker(source.slice(entry.start, entry.end))
    ? entry
    : undefined;
}

/** What the session-cookie edit and its verdict call the file they read. */
const VITE_CONFIG_LABEL = "the Vite config (vite.config.*)";

/**
 * The CLI's own `/__nextgen` entry in `source` (LF line ends), or `undefined`
 * when there is no such entry.
 */
function cliEntry(source: string): CliEntry | undefined {
  // At tabWidth 1 the node offsets index the source itself; at recast's
  // default a tab counts as four, which a tab-indented config would expose.
  const file = ConfigModule.open(source, VITE_CONFIG_LABEL, { tabWidth: 1 });
  return cliEntryOf(file.exportedObject(), source);
}

/** How many statements the hooks before ADR 083 are: the project id, the cookie name and the two listeners. */
const V1_HOOK_STATEMENTS = 4;

/**
 * `text` (LF line ends) with the session-cookie hooks the CLI wrote before
 * ADR 083 replaced by the current ones, at their indentation, or `undefined`
 * when the CLI's entry does not carry them as the CLI wrote them, whatever a
 * formatter did to their layout.
 */
function withCurrentHooks(text: string): string | undefined {
  const marker = text.indexOf(`/* ${SESSION_COOKIE_MARKER_V1} */`);
  const statements = marker === -1 ? undefined : cliEntry(text)?.statements;
  const first =
    statements?.findIndex((statement) => {
      return statement.start > marker;
    }) ?? -1;
  const last = statements?.[first + V1_HOOK_STATEMENTS - 1];
  if (first === -1 || !last) {
    return undefined;
  }
  const lineStart = text.lastIndexOf("\n", marker - 1) + 1;
  if (
    fingerprint(text.slice(lineStart, last.end)) !==
    fingerprint(viteSessionCookieStatementsV1().join("\n"))
  ) {
    return undefined;
  }
  const indent = /^[\t ]*/.exec(text.slice(lineStart, marker))?.[0] ?? "";
  return `${text.slice(0, lineStart)}${indented(viteSessionCookieStatements(), indent)}${text.slice(last.end)}`;
}

/**
 * Builds the `edit` transform that gives the CLI's own `/__nextgen` entry the
 * session-cookie hooks (ADR 073, ADR 083), for apps set up before the entry
 * carried them: the hooks go after the last statement of its `configure(proxy)`
 * body, at that statement's indentation, and nothing else in the file changes.
 * The hooks the CLI wrote before ADR 083 are replaced where they stand. A
 * config whose entry carries the current hooks already, a hand-written entry,
 * one whose bearer hook was changed and one whose hooks before ADR 083 were
 * changed are returned untouched; {@link viteSessionCookieVerdict} tells the
 * doctor which it is. Line ends are the file's own (CRLF or LF). Throws
 * `E_VALIDATION`, as {@link viteProxyEdit} does, when the file is absent or
 * unreadable.
 */
export function viteSessionCookieEdit(): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      // Throws the E_VALIDATION a missing config gets everywhere.
      ConfigModule.open(source, VITE_CONFIG_LABEL, { tabWidth: 1 });
      return "";
    }
    return withLfLineEnds(source, (text) => {
      if (text.includes(SESSION_COOKIE_MARKER)) {
        return text;
      }
      if (text.includes(SESSION_COOKIE_MARKER_V1)) {
        return withCurrentHooks(text) ?? text;
      }
      const last = cliEntry(text)?.statements.at(-1);
      if (!last) {
        return text;
      }
      const lineStart = text.lastIndexOf("\n", last.start - 1) + 1;
      const indent = /^[\t ]*/.exec(text.slice(lineStart, last.start))?.[0] ?? "";
      return `${text.slice(0, last.end)}\n${indented(viteSessionCookieStatements(), indent)}${text.slice(last.end)}`;
    });
  };
}

/**
 * Whether the Vite config carries the session-cookie hooks, for the doctor.
 * The CLI's entry without them is `detached` (`doctor --fix` adds them), and so
 * is a config without the CLI's entry, which the proxy edit writes with them.
 * An entry the CLI wrote whose bearer hook was changed by hand is `unknown`:
 * the edit cannot place the hooks there, and only the developer can. Hooks
 * from before ADR 083 are `outdated`: they keep the session in cookies the
 * server no longer reads.
 */
export function viteSessionCookieVerdict(source: string): WiringVerdict {
  const text = lfText(source);
  if (text.includes(SESSION_COOKIE_MARKER)) {
    return "applied";
  }
  if (text.includes(SESSION_COOKIE_MARKER_V1)) {
    return {
      outdated:
        withCurrentHooks(text) === undefined
          ? "its session-cookie hooks name the session cookies before ADR 083 and were changed since zitadel setup wrote them, so they must be updated by hand"
          : "its session-cookie hooks name the session cookies before ADR 083; doctor --fix updates them",
    };
  }
  if (cliEntry(text)) {
    return "detached";
  }
  return hasProxyCredentialPolicyMarker(text)
    ? {
        unknown:
          "its /__nextgen proxy entry was changed since zitadel setup wrote it, so the session-cookie hooks (ADR 073) must be added by hand",
      }
    : "detached";
}

/**
 * Builds the `edit` transform that moves the CLI's own `/__nextgen` entry from
 * v2, whose bearer hook knew only `/sessions/exchange`, to v3, which knows the
 * exchange under the API prefix too (ADR 077): once an app's packages call
 * `/api/v1`, a v2 proxy no longer attaches the project secret to the exchange.
 * Only the hook statement and the entry's marker change, whatever the
 * formatter did to the rest; a hand-written entry, a hook changed by hand and
 * a v3 entry are returned untouched, and {@link viteApiPrefixVerdict} tells
 * the doctor which it is. Line ends are the file's own. Throws `E_VALIDATION`,
 * as {@link viteProxyEdit} does, when the file is absent or unreadable.
 */
export function viteApiPrefixEdit(): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      // Throws the E_VALIDATION a missing config gets everywhere.
      ConfigModule.open(source, VITE_CONFIG_LABEL, { tabWidth: 1 });
      return "";
    }
    return withLfLineEnds(source, (text) => {
      const found = cliEntry(text);
      if (found?.hook.version !== "v2") {
        return text;
      }
      const { entry, hook } = found;
      const lineStart = text.lastIndexOf("\n", hook.node.start - 1) + 1;
      const indent = /^[\t ]*/.exec(text.slice(lineStart, hook.node.start))?.[0] ?? "";
      const migrated =
        text.slice(entry.start, hook.node.start) +
        bearerListener(indent).slice(indent.length) +
        text.slice(hook.node.end, entry.end);
      return (
        text.slice(0, entry.start) +
        migrated.replaceAll(PROXY_CREDENTIAL_POLICY_V2_MARKER, PROXY_CREDENTIAL_POLICY_MARKER) +
        text.slice(entry.end)
      );
    });
  };
}

/**
 * Whether the Vite config's dev proxy attaches the project secret to the
 * exchange under the API prefix too, for the doctor. The CLI's v2 entry is
 * `detached` (`doctor --fix` moves it to v3); an entry the CLI wrote whose hook
 * was changed by hand, and a hand-written proxy that attaches the secret but
 * never names `/api/v1/sessions/exchange`, are `unknown`: only the developer can
 * change them. A config with no proxy that attaches the secret has nothing to
 * move.
 */
export function viteApiPrefixVerdict(source: string): WiringVerdict {
  const text = lfText(source);
  const found = cliEntry(text);
  if (found) {
    return found.hook.version === "v3" ? "applied" : "detached";
  }
  if (hasProxyCredentialPolicyMarker(text)) {
    return {
      unknown: `its /__nextgen proxy entry was changed since zitadel setup wrote it, so its project-secret check must accept ${PREFIXED_EXCHANGE_PATH} by hand (ADR 077)`,
    };
  }
  if (
    text.includes(PROXY_PATH) &&
    text.includes("ZITADEL_PROJECT_SECRET") &&
    !text.includes(PREFIXED_EXCHANGE_PATH)
  ) {
    return {
      unknown: `its /__nextgen proxy is not the one zitadel setup writes, so its project-secret check must accept ${PREFIXED_EXCHANGE_PATH} by hand (ADR 077)`,
    };
  }
  return "applied";
}

/**
 * The `target` of the marked `/__nextgen` entry in `text` (LF line ends), with
 * the entry and, when the CLI wrote it, the CLI's entry around it, or
 * `undefined` when setup wrote no entry there.
 */
function targetOf(text: string):
  | {
      readonly entry: AstNode;
      readonly node: AstNode | undefined;
      readonly cli: CliEntry | undefined;
    }
  | undefined {
  const file = ConfigModule.open(text, VITE_CONFIG_LABEL, { tabWidth: 1 });
  const config = file.exportedObject();
  const entry = markedEntryOf(config, text);
  if (!entry) {
    return undefined;
  }
  return {
    entry,
    node: propertyOf(entry.value, "target")?.value,
    cli: cliEntryOf(config, text),
  };
}

/** The address a string-literal `target` fixes, or `undefined` for any other target. */
function fixedAddress(text: string, target: AstNode | undefined): string | undefined {
  if (target?.type !== "StringLiteral") {
    return undefined;
  }
  return /^(["'])([^"'\\]*)\1$/.exec(text.slice(target.start, target.end))?.[2];
}

/** Whether `address` names the same server as `server`. */
function sameOrigin(address: string, server: string): boolean {
  try {
    return new URL(address).origin === new URL(server).origin;
  } catch {
    return false;
  }
}

/** {@link serverAddress} fingerprinted around its fallback, which may be any string literal. */
const SERVER_ADDRESS_FINGERPRINT = (() => {
  const placeholder = '"@fallback@"';
  const [before = "", after = ""] = fingerprint(serverAddress("@fallback@")).split(placeholder);
  return { before, after };
})();

/** Whether `target` reads `ZITADEL_URL` as setup writes it, whatever its fallback and layout. */
function readsServerAddress(text: string, target: AstNode | undefined): boolean {
  if (!target) {
    return false;
  }
  const printed = fingerprint(text.slice(target.start, target.end));
  const { before, after } = SERVER_ADDRESS_FINGERPRINT;
  return (
    printed.startsWith(before) &&
    printed.endsWith(after) &&
    /^"[^"]*"$/.test(printed.slice(before.length, printed.length - after.length))
  );
}

/**
 * Whether `override`, the `ZITADEL_URL` the app's development env files set,
 * would move a proxy that fixes `address` to another server once it reads the
 * variable. Unset and empty leave it on the fallback.
 */
function movesAway(address: string, override: DevelopmentServerUrl | undefined): boolean {
  return override !== undefined && override.value !== "" && !sameOrigin(override.value, address);
}

/**
 * Builds the `edit` transform that moves the CLI's own v3 `/__nextgen` entry
 * off the address setup used to fix in it, `target: "<address>"`, onto
 * `ZITADEL_URL` with that address as the fallback ({@link serverAddress}), and
 * marks it v4. Nothing moves between files: an app with no `ZITADEL_URL`
 * keeps reaching the address it had. `override` is what the app's development
 * env files set the variable to; one naming another server would move the app
 * there, so the entry is left as it is. So are a hand-written entry, one whose
 * bearer hook was changed, any other target, a v2 entry (the API-prefix edit
 * moves it to v3 first) and a v4 entry, whose literal target was put there on
 * purpose; {@link viteServerAddressVerdict} tells the doctor which it is. Line
 * ends are the file's own. Throws `E_VALIDATION`, as {@link viteProxyEdit}
 * does, when the file is absent or unreadable.
 */
export function viteServerAddressEdit(
  override?: DevelopmentServerUrl,
): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      // Throws the E_VALIDATION a missing config gets everywhere.
      ConfigModule.open(source, VITE_CONFIG_LABEL, { tabWidth: 1 });
      return "";
    }
    return withLfLineEnds(source, (text) => {
      const found = targetOf(text);
      const target = found?.node;
      const address = fixedAddress(text, target);
      if (
        !found ||
        !target ||
        address === undefined ||
        found.cli?.hook.version !== "v3" ||
        text.slice(found.entry.start, found.entry.end).includes(PROXY_ADDRESS_MARKER) ||
        movesAway(address, override)
      ) {
        return text;
      }
      const lineStart = text.lastIndexOf("\n", target.start - 1) + 1;
      const indent = /^[\t ]*/.exec(text.slice(lineStart, target.start))?.[0] ?? "";
      const entry =
        text.slice(found.entry.start, target.start) +
        indentedTail(serverAddress(address), indent) +
        text.slice(target.end, found.entry.end);
      return (
        text.slice(0, found.entry.start) +
        entry.replaceAll(PROXY_CREDENTIAL_POLICY_MARKER, PROXY_ADDRESS_MARKER) +
        text.slice(found.entry.end)
      );
    });
  };
}

/**
 * Whether the Vite config's dev proxy reads the server's address from
 * `ZITADEL_URL`, for the doctor. A proxy that fixes the address works, so
 * nothing here fails: the CLI's v2 or v3 entry `doctor --fix` can move is
 * `detached`, and what only the developer can settle is `unknown`, a warning
 * that says what to do: a `ZITADEL_URL` in `override.file` that names another
 * server, an entry changed since setup wrote it, a target of its own, and a
 * literal target in a v4 entry, which was put back on purpose. A config
 * without a marked entry has nothing to move.
 */
export function viteServerAddressVerdict(
  override?: DevelopmentServerUrl,
): (source: string) => WiringVerdict {
  return (source) => {
    const text = lfText(source);
    const found = targetOf(text);
    if (!found || readsServerAddress(text, found.node)) {
      return "applied";
    }
    const address = fixedAddress(text, found.node);
    const fixes = address === undefined ? "sets a target of its own" : `fixes ${address}`;
    const entry = text.slice(found.entry.start, found.entry.end);
    if (entry.includes(PROXY_ADDRESS_MARKER)) {
      return {
        unknown: /\bZITADEL_URL\b/.test(text.slice(found.node?.start, found.node?.end))
          ? "its /__nextgen proxy reads ZITADEL_URL in a target of its own, so the doctor cannot tell which server it reaches; leave it if that is on purpose"
          : `its /__nextgen proxy ${fixes} instead of reading ZITADEL_URL; leave it if that is on purpose, or set its target back to read ZITADEL_URL`,
      };
    }
    if (!found.cli || address === undefined) {
      return {
        unknown: `its /__nextgen proxy ${fixes} and was changed since zitadel setup wrote it, so only a change by hand lets ZITADEL_URL point it at another server`,
      };
    }
    if (override !== undefined && movesAway(address, override)) {
      const names = override.held
        ? `${override.file} sets ZITADEL_URL to ${override.value}`
        : `zitadel.json names ${override.value}, which doctor --fix writes to ${override.file} as ZITADEL_URL`;
      return {
        unknown: `its /__nextgen proxy fixes ${address}, but ${names}, and the proxy would follow that once it reads the variable, so doctor --fix leaves it: to stay on ${address}, set ZITADEL_URL to it in ${override.file} and run doctor --fix again; to move to ${override.value}, change the target by hand`,
      };
    }
    return "detached";
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
 * Vite framework): contributes the file-ops that non-destructively merge the
 * `/__nextgen` dev proxy into the project's Vite config. A patcher opts in by
 * declaring `implements ViteSupport` and spreading {@link viteProxyOp},
 * {@link viteApiPrefixOp}, {@link viteSessionCookieOp} and
 * {@link viteServerAddressOp} into its `routeOps`, so the proxy logic is
 * written once and reused everywhere — no per-framework duplication.
 */
export interface ViteSupport {
  /** The `edit` file-op that merges the `/__nextgen` proxy into the Vite config. */
  viteProxyOp(devPort: number, server: string, previousPort?: number): FileOp;
  /** The `edit` file-op that gives a proxy setup wrote before its session-cookie hooks. */
  viteSessionCookieOp(): FileOp;
  /** The `edit` file-op that moves a v2 proxy's exchange check to the API prefix as well. */
  viteApiPrefixOp(): FileOp;
  /** The `edit` file-op that moves the address a proxy fixes onto `ZITADEL_URL`, as its fallback. */
  viteServerAddressOp(override?: DevelopmentServerUrl): FileOp;
}

/** Builds the shared Vite-config proxy {@link FileOp} for a {@link ViteSupport} patcher. */
export function buildViteProxyOp(devPort: number, server: string, previousPort?: number): FileOp {
  return {
    kind: "edit",
    path: [...VITE_CONFIG_PATHS],
    edit: viteProxyEdit(devPort, server, previousPort),
    // The dev proxy is the auth request path — the doctor managed-files
    // check fails when this merge is no longer applied.
    wiring: "infrastructure",
  };
}

/** Builds the shared session-cookie {@link FileOp} for a {@link ViteSupport} patcher. */
export function buildViteSessionCookieOp(): FileOp {
  return {
    kind: "edit",
    path: [...VITE_CONFIG_PATHS],
    edit: viteSessionCookieEdit(),
    // A session cookie per project (ADR 073) keeps the Console and the app
    // from signing each other out on localhost. Sign-in works without it, so
    // the doctor only warns while it is missing; hooks from before ADR 083
    // fail it (`outdated`).
    wiring: "convenience",
    verify: viteSessionCookieVerdict,
  };
}

/** Builds the shared API-prefix {@link FileOp} for a {@link ViteSupport} patcher. */
export function buildViteApiPrefixOp(): FileOp {
  return {
    kind: "edit",
    path: [...VITE_CONFIG_PATHS],
    edit: viteApiPrefixEdit(),
    // The packages call the API under /api/v1 (ADR 077), and a v2 proxy
    // attaches the project secret only to the exchange at the root, so sign-in
    // fails: the doctor fails until `doctor --fix` moves the proxy to v3.
    wiring: "infrastructure",
    verify: viteApiPrefixVerdict,
  };
}

/**
 * Builds the shared server-address {@link FileOp} for a {@link ViteSupport}
 * patcher. `override` is the `ZITADEL_URL` the app's development env files
 * set once the base ops ran (`AbstractRulePatcher.developmentServerUrl`).
 */
export function buildViteServerAddressOp(override?: DevelopmentServerUrl): FileOp {
  return {
    kind: "edit",
    path: [...VITE_CONFIG_PATHS],
    edit: viteServerAddressEdit(override),
    // A proxy that fixes the address works; it only cannot be pointed at
    // another server, a test server included. So the doctor warns until
    // `doctor --fix` moves it, and never fails it.
    wiring: "convenience",
    verify: viteServerAddressVerdict(override),
  };
}
