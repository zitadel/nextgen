import { parseModule } from "magicast";

import { MANAGED_MARKER } from "../../../../paths";
import type { PatchContext } from "../../types";
import { PROXY_PATH } from "../proxy";
import {
  type AstNode,
  assertNoUnreviewedProjectSecretProxy,
  EXCHANGE_REDACTION_MARKER,
  EXCHANGE_REDACTION_ZLIB,
  exchangeRedactionFunctions,
  hasResponseHook,
  PROXY_CREDENTIAL_POLICY_MARKER,
  proxyEntryRange,
  upgradeExchangeRedaction,
} from "../proxy-credential-policy";

/**
 * The managed root component `src/app/app.ts`: a standalone component that
 * renders the `@zitadel/sdk-angular` widgets based on the current path. The
 * project id (public, not secret) is inlined; the dev proxy in `proxy.conf.cjs`
 * attaches the project service-key secret as the bearer server-side only to
 * `POST /sessions/exchange` (read from `.env.local`), and no secret reaches
 * the browser.
 *
 * Projects set up with the business use case additionally expose the SDK's
 * `businessLocales` overlay as a class property, which `app.html` binds to the
 * login widgets via `[locales]` — restoring work-email copy on top of the
 * widget's neutral built-in dictionaries.
 */
export function appComponentTemplate(ctx: PatchContext): string {
  const business = ctx.useCase === "business";
  const importNames = business
    ? `
  ZitadelLoginComponent,
  ZitadelSessionComponent,
  businessLocales,
  configureZitadel,
`
    : `
  ZitadelLoginComponent,
  ZitadelSessionComponent,
  configureZitadel,
`;
  // The overlay ships with the SDK, so the generated app only wires it up
  // (and stays plain otherwise).
  const localesProperty = business
    ? `
  // Set up for a business audience: businessLocales overlays work-email copy
  // on the login widget's neutral built-in dictionaries. Remove it (and the
  // [locales] binding in app.html) to fall back to the neutral wording.
  protected readonly locales = businessLocales;`
    : "";
  return `${MANAGED_MARKER}
import { Component, OnInit } from "@angular/core";
import {${importNames}} from "@zitadel/sdk-angular";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [ZitadelLoginComponent, ZitadelSessionComponent],
  templateUrl: "./app.html",
})
export class App implements OnInit {
  protected readonly project = configureZitadel({
    projectId: ${JSON.stringify(ctx.project.id)},
    proxyPath: "${PROXY_PATH}",
  });
  protected readonly path = window.location.pathname;${localesProperty}

  ngOnInit(): void {
    if (this.path === "/") {
      window.location.replace("/login");
    }
  }
}
`;
}

/**
 * The managed `src/app/app.html`. The marker lives in an HTML comment that still
 * contains the literal managed-marker text, so eject/doctor stay marker-aware.
 * Business-use-case scaffolds bind the component's `locales` overlay property
 * onto the login widgets.
 */
export function appTemplateHtml(ctx: PatchContext): string {
  const localesBinding = ctx.useCase === "business" ? `\n      [locales]="locales"` : "";
  return `<!-- ${MANAGED_MARKER} -->
@if (path.startsWith('/profile')) {
  <div style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
    <zitadel-auth-session
      [project]="project"
      [postSignOutUrl]="'/login'"
    ></zitadel-auth-session>
  </div>
} @else if (path.startsWith('/register')) {
  <div style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
    <zitadel-auth-login
      [project]="project"${localesBinding}
      purpose="register"
      [postSignInUrl]="'/profile'"
    ></zitadel-auth-login>
  </div>
} @else {
  <div style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
    <zitadel-auth-login
      [project]="project"${localesBinding}
      purpose="login"
      [postSignInUrl]="'/profile'"
    ></zitadel-auth-login>
  </div>
}
`;
}

/**
 * The managed `proxy.conf.cjs` for `ng serve`: forwards `/__nextgen/*` to the
 * backend and attaches the project's service-key secret only to the current
 * app-plane `POST /sessions/exchange` request. Both the backend URL
 * (`ZITADEL_URL`) and the secret
 * (`ZITADEL_PROJECT_SECRET`) are read from `.env.local`, which `zitadel setup`
 * writes and `.gitignore` excludes — Angular's CLI does not auto-load env files
 * into the dev-server process, so this file does it itself with a small inline
 * parser. The prefix strip and the bearer are each provided in both the
 * http-proxy-middleware form (`pathRewrite`/`onProxyReq`) and the Vite form
 * (`rewrite`/`configure`), so both fire whichever proxy layer Angular's
 * dev server uses. Like the Vite proxy (`vite-support.ts`), it addresses the
 * backend by its own name (`changeOrigin`), which a remote https server
 * requires, and forwards the app's origin in `X-Forwarded-Host` and
 * `X-Forwarded-Proto` (`xfwd`). Like the Vite proxy, it writes every response
 * itself (`selfHandleResponse`), so it can drop the HttpOnly session token from
 * the exchange's body before the browser sees it.
 */
export function proxyConfTemplate(): string {
  return `${MANAGED_MARKER}
const { readFileSync, existsSync } = require("node:fs");

function loadEnvLocal() {
  if (!existsSync(".env.local")) return {};
  const out = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\\r?\\n/)) {
    const m = line.match(/^\\s*(?:export\\s+)?([A-Z_][A-Z0-9_]*)\\s*=\\s*(.*)$/);
    if (m) {
      const raw = m[2].trim();
      const quoted = raw.match(/^(['"])(.*)\\1\\s*(?:#.*)?$/);
      out[m[1]] = quoted ? quoted[2] : raw.replace(/\\s+#.*$/, "").trim();
    }
  }
  return out;
}

const env = loadEnvLocal();
const server = process.env.ZITADEL_URL ?? env.ZITADEL_URL;
const secret = process.env.ZITADEL_PROJECT_SECRET ?? env.ZITADEL_PROJECT_SECRET;
if (!server) {
  throw new Error("ZITADEL_URL is not set; add it to .env.local (zitadel setup writes it).");
}
if (!secret) {
  throw new Error("ZITADEL_PROJECT_SECRET is not set; add it to .env.local (zitadel setup writes it).");
}
const bearer = \`Bearer \${secret}\`;

${EXCHANGE_ONLY_BEARER}

${EXCHANGE_REDACTION}

function stripPrefix(path) {
  return path.replace(/^\\${PROXY_PATH}/, "").replace(/^(?!\\/)/, "/");
}

module.exports = {
  "${PROXY_PATH}": {
    target: server,
    changeOrigin: true,
    xfwd: true,
    pathRewrite: stripPrefix,
    rewrite: stripPrefix,
${REDACTING_WIRING}
  },
};
`;
}

const LEGACY_UNCONDITIONAL_BEARER = `function setBearer(proxyReq) {
  proxyReq.setHeader("authorization", bearer);
}`;

const EXCHANGE_ONLY_BEARER = `/* ${PROXY_CREDENTIAL_POLICY_MARKER} */
function setBearer(proxyReq) {
  const pathname = new URL(proxyReq.path, "http://zitadel.local").pathname;
  if (
    proxyReq.method === "POST" &&
    pathname === "/sessions/exchange" &&
    !proxyReq.getHeader("authorization")
  ) {
    proxyReq.setHeader("authorization", bearer);
  }
}`;

/** The redaction functions and the `node:zlib` decoders they call. */
function exchangeRedaction(indent: string): string {
  return `${indent}const ${EXCHANGE_REDACTION_ZLIB} = require("node:zlib");

${exchangeRedactionFunctions(indent)}`;
}

const EXCHANGE_REDACTION = exchangeRedaction("");

/** The listener wiring emitted before the session-token redaction existed. */
const UNREDACTED_WIRING = `    onProxyReq: setBearer,
    configure: (proxy) => proxy.on("proxyReq", setBearer),`;

/**
 * The listener wiring with the redaction: the proxy writes every response
 * itself, in the http-proxy-middleware form and the Vite form alike.
 */
const REDACTING_WIRING = `    selfHandleResponse: true,
    onProxyReq: (proxyReq) => {
      setBearer(proxyReq);
      requestPlainExchange(proxyReq);
    },
    onProxyRes: relayResponse,
    configure: (proxy) => {
      proxy.on("proxyReq", setBearer);
      proxy.on("proxyReq", requestPlainExchange);
      proxy.on("proxyRes", relayResponse);
    },`;

/** The slice of a parsed node {@link managedEntryRange} walks to `module.exports`. */
interface ExportsNode extends AstNode {
  name?: string;
  body?: ExportsNode[];
  program?: ExportsNode;
  expression?: ExportsNode;
  left?: ExportsNode;
  object?: ExportsNode;
  property?: ExportsNode;
  right?: AstNode;
}

/**
 * The span of the managed `"/__nextgen"` property of the object literal
 * assigned to `module.exports`, found in the parsed file, or `undefined` when
 * the file is not shaped like that. Every check and rewrite of the entry stays
 * inside this span, so a sibling proxy that copies the generated wiring, or a
 * comment or string holding braces, is never mistaken for it.
 */
function managedEntryRange(source: string): { start: number; end: number } | undefined {
  let ast: ExportsNode;
  try {
    ast = parseModule(source).$ast as ExportsNode;
  } catch {
    return undefined;
  }
  const statements = ast.program?.body ?? ast.body ?? [];
  for (const statement of statements) {
    const assignment = statement.expression;
    const target = assignment?.left;
    if (
      assignment?.type === "AssignmentExpression" &&
      target?.type === "MemberExpression" &&
      target.object?.name === "module" &&
      target.property?.name === "exports"
    ) {
      return proxyEntryRange(source, assignment.right);
    }
  }
  return undefined;
}

/** Rewrites the managed entry's own text with `edit`, leaving the rest of the file as it is. */
function editManagedEntry(source: string, edit: (entry: string) => string): string {
  const range = managedEntryRange(source);
  if (range === undefined) {
    return source;
  }
  return (
    source.slice(0, range.start) +
    edit(source.slice(range.start, range.end)) +
    source.slice(range.end)
  );
}

/**
 * Adds the session-token redaction to the managed proxy written before it
 * existed. Only the exact generated bearer hook and wiring qualify, and both
 * change together: a response handler without `selfHandleResponse`, or the
 * reverse, would break every proxied call. A file whose managed entry already
 * chose its own `selfHandleResponse`, or hooks the responses itself, is left
 * alone.
 */
function redactExchange(source: string): string {
  const range = managedEntryRange(source);
  if (
    range === undefined ||
    source.includes(EXCHANGE_REDACTION_MARKER) ||
    !source.includes(EXCHANGE_ONLY_BEARER)
  ) {
    return source;
  }
  const entry = source.slice(range.start, range.end);
  if (
    /\bselfHandleResponse\b/.test(entry) ||
    // A hook of the project's own would run after the headers were sent.
    hasResponseHook(entry) ||
    !entry.includes(UNREDACTED_WIRING)
  ) {
    return source;
  }
  const wired =
    source.slice(0, range.start) +
    entry.replace(UNREDACTED_WIRING, () => REDACTING_WIRING) +
    source.slice(range.end);
  return wired.replace(
    EXCHANGE_ONLY_BEARER,
    () => `${EXCHANGE_ONLY_BEARER}\n\n${EXCHANGE_REDACTION}`,
  );
}

/**
 * The managed entry as emitted before it forwarded the app's origin, and what
 * replaces it. Keeping the browser's `Host` also kept `localhost` as the TLS
 * server name, so that proxy could reach no remote https server.
 */
const HOST_KEEPING_ENTRY = `    target: server,
    changeOrigin: false,
`;

const ORIGIN_FORWARDING_ENTRY = `    target: server,
    changeOrigin: true,
    xfwd: true,
`;

/** Upgrades the exact host-keeping entry, unless it already chose its own `xfwd`. */
function forwardAppOrigin(source: string): string {
  return editManagedEntry(source, (entry) =>
    /\bxfwd\s*:/.test(entry)
      ? entry
      : entry.replace(HOST_KEEPING_ENTRY, () => ORIGIN_FORWARDING_ENTRY),
  );
}

/** Moves a managed proxy's generated parts onto their current shapes. */
function upgradeManaged(source: string): string {
  return redactExchange(forwardAppOrigin(upgradeExchangeRedaction(source, exchangeRedaction)));
}

function upgradeLf(source: string): string {
  if (source.includes(MANAGED_MARKER) && source.includes(LEGACY_UNCONDITIONAL_BEARER)) {
    return upgradeManaged(source.replace(LEGACY_UNCONDITIONAL_BEARER, EXCHANGE_ONLY_BEARER));
  }
  assertNoUnreviewedProjectSecretProxy(source, "proxy.conf.cjs");
  return source.includes(MANAGED_MARKER) ? upgradeManaged(source) : source;
}

/**
 * Creates the managed Angular proxy and upgrades the exact shapes earlier CLIs
 * emitted: the insecure unconditional bearer hook, the host-keeping entry, the
 * wiring that relayed the session token to the browser, and the redaction that
 * relayed a compressed exchange answer unread.
 * Other edits are preserved; a safe custom proxy is left untouched, while an
 * unrecognized proxy that may still over-forward the project secret is
 * surfaced for manual review.
 */
export function proxyConfEdit(): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      return proxyConfTemplate();
    }
    // The generated fragments are matched with LF newlines, so a CRLF file is
    // upgraded as LF and written back with its own line endings.
    const crlf = source.includes("\r\n");
    const lf = crlf ? source.replace(/\r\n/g, "\n") : source;
    const next = upgradeLf(lf);
    if (next === lf) {
      return source;
    }
    return crlf ? next.replace(/\n/g, "\r\n") : next;
  };
}
