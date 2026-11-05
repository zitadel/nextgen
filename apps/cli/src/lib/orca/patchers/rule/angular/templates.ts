import { MANAGED_MARKER } from "../../../../paths";
import type { PatchContext } from "../../types";
import type { WiringVerdict } from "../file-writer/types";
import { PROXY_PATH } from "../proxy";
import {
  assertNoUnreviewedProjectSecretProxy,
  EXCHANGE_PATH_CHECK,
  PREFIXED_EXCHANGE_PATH,
  PROXY_CREDENTIAL_POLICY_MARKER,
  PROXY_CREDENTIAL_POLICY_V2_MARKER,
  V2_EXCHANGE_PATH_CHECK,
} from "../proxy-credential-policy";
import {
  indented,
  proxyConfSessionCookieStatements,
  proxyConfSessionCookieStatementsV1,
  SESSION_COOKIE_MARKER,
  SESSION_COOKIE_MARKER_V1,
} from "../session-cookie";
import { lfText, withLfLineEnds } from "../utils/line-ends";

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
 * app-plane `POST /sessions/exchange` request, which it knows with and without
 * the API prefix (`/api/v1`, ADR 077). Both the backend URL
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
 * `X-Forwarded-Proto` (`xfwd`), and it keeps the session cookie under the
 * app's project's name in the browser (`ZITADEL_PROJECT_ID`, ADR 073,
 * ADR 083).
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

${SESSION_COOKIE_FUNCTIONS}

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
${SESSION_COOKIE_HOOKS}  },
};
`;
}

const LEGACY_UNCONDITIONAL_BEARER = `function setBearer(proxyReq) {
  proxyReq.setHeader("authorization", bearer);
}`;

/** The bearer hook, marked with the credential policy `marker`, testing the path with `pathCheck`. */
function exchangeOnlyBearer(marker: string, pathCheck: string): string {
  return `/* ${marker} */
function setBearer(proxyReq) {
  const pathname = new URL(proxyReq.path, "http://zitadel.local").pathname;
  if (
    proxyReq.method === "POST" &&
    ${pathCheck} &&
    !proxyReq.getHeader("authorization")
  ) {
    proxyReq.setHeader("authorization", bearer);
  }
}`;
}

const EXCHANGE_ONLY_BEARER = exchangeOnlyBearer(
  PROXY_CREDENTIAL_POLICY_MARKER,
  EXCHANGE_PATH_CHECK,
);

/** The bearer hook as the CLI wrote it before it knew the API prefix (ADR 077). */
const V2_EXCHANGE_ONLY_BEARER = exchangeOnlyBearer(
  PROXY_CREDENTIAL_POLICY_V2_MARKER,
  V2_EXCHANGE_PATH_CHECK,
);

/** The exchange-only bearer hook `text` carries, of either version, or `undefined`. */
function bearerIn(text: string): string | undefined {
  return [EXCHANGE_ONLY_BEARER, V2_EXCHANGE_ONLY_BEARER].find((bearer) => text.includes(bearer));
}

/** The session-cookie hooks' functions, after the bearer hook (ADR 073, ADR 083). */
const SESSION_COOKIE_FUNCTIONS = indented(proxyConfSessionCookieStatements(), "");

/** The session-cookie hooks' functions as the CLI wrote them before ADR 083. */
const SESSION_COOKIE_FUNCTIONS_V1 = indented(proxyConfSessionCookieStatementsV1(), "");

/** How the managed entry attached its hooks before it carried the session-cookie ones. */
const BEARER_ONLY_HOOKS = `    onProxyReq: setBearer,
    configure: (proxy) => proxy.on("proxyReq", setBearer),
`;

/** How the managed entry attached the bearer and the session-cookie hooks before ADR 083. */
const SESSION_COOKIE_HOOKS_V1 = `    onProxyReq: (proxyReq) => {
      setBearer(proxyReq);
      forwardSessionCookie(proxyReq);
    },
    onProxyRes: renameSessionCookie,
    configure: (proxy) => {
      proxy.on("proxyReq", setBearer);
      proxy.on("proxyReq", forwardSessionCookie);
      proxy.on("proxyRes", renameSessionCookie);
    },
`;

/**
 * How the managed entry attaches the bearer and the session-cookie hooks. Each
 * cookie hook takes the browser's request too, whose scheme names the cookie.
 */
const SESSION_COOKIE_HOOKS = `    onProxyReq: (proxyReq, req) => {
      setBearer(proxyReq);
      forwardSessionCookie(proxyReq, req);
    },
    onProxyRes: renameSessionCookie,
    configure: (proxy) => {
      proxy.on("proxyReq", setBearer);
      proxy.on("proxyReq", forwardSessionCookie);
      proxy.on("proxyRes", renameSessionCookie);
    },
`;

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

/** Upgrades the exact host-keeping entry, unless the file already chose its own `xfwd`. */
function forwardAppOrigin(source: string): string {
  if (/\bxfwd\s*:/.test(source)) {
    return source;
  }
  return source.replace(HOST_KEEPING_ENTRY, ORIGIN_FORWARDING_ENTRY);
}

/**
 * Creates the managed Angular proxy and upgrades the exact shapes earlier CLIs
 * emitted: the insecure unconditional bearer hook and the host-keeping entry.
 * Other edits are preserved; a safe custom proxy is left untouched, while an
 * unrecognized proxy that may still over-forward the project secret is
 * surfaced for manual review.
 */
export function proxyConfEdit(): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      return proxyConfTemplate();
    }
    return withLfLineEnds(source, (text) => {
      if (text.includes(MANAGED_MARKER) && text.includes(LEGACY_UNCONDITIONAL_BEARER)) {
        return forwardAppOrigin(text.replace(LEGACY_UNCONDITIONAL_BEARER, EXCHANGE_ONLY_BEARER));
      }
      assertNoUnreviewedProjectSecretProxy(text, "proxy.conf.cjs");
      return text.includes(MANAGED_MARKER) ? forwardAppOrigin(text) : text;
    });
  };
}

/** Whether `text` (LF line ends) is the managed proxy as an earlier CLI wrote it, without the session-cookie hooks. */
function hasBearerOnlyHooks(text: string): boolean {
  return (
    text.includes(MANAGED_MARKER) &&
    bearerIn(text) !== undefined &&
    text.includes(BEARER_ONLY_HOOKS)
  );
}

/** Whether `text` (LF line ends) is the managed proxy with the session-cookie hooks the CLI wrote before ADR 083. */
function hasV1Hooks(text: string): boolean {
  return (
    text.includes(MANAGED_MARKER) &&
    text.includes(SESSION_COOKIE_FUNCTIONS_V1) &&
    text.includes(SESSION_COOKIE_HOOKS_V1)
  );
}

/**
 * Gives the managed proxy the session-cookie hooks (ADR 073, ADR 083) when it
 * is the exact file an earlier CLI wrote: the hook functions go after the
 * bearer hook, and the entry attaches them beside it; the hooks from before
 * ADR 083 are replaced where they stand. A file that carries the current hooks
 * already, an unmanaged one, and a managed one whose hooks were changed by
 * hand are left as they are; {@link proxyConfSessionCookieVerdict} tells the
 * doctor which it is. Line ends are the file's own (CRLF or LF). Creates the
 * managed proxy when it is absent, as {@link proxyConfEdit} does.
 */
export function proxyConfSessionCookieEdit(): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      return proxyConfTemplate();
    }
    return withLfLineEnds(source, (text) => {
      if (text.includes(SESSION_COOKIE_MARKER)) {
        return text;
      }
      if (hasV1Hooks(text)) {
        return text
          .replace(SESSION_COOKIE_FUNCTIONS_V1, SESSION_COOKIE_FUNCTIONS)
          .replace(SESSION_COOKIE_HOOKS_V1, SESSION_COOKIE_HOOKS);
      }
      const bearer = bearerIn(text);
      return bearer && hasBearerOnlyHooks(text)
        ? text
            .replace(bearer, `${bearer}\n\n${SESSION_COOKIE_FUNCTIONS}`)
            .replace(BEARER_ONLY_HOOKS, SESSION_COOKIE_HOOKS)
        : text;
    });
  };
}

/**
 * Whether `proxy.conf.cjs` carries the session-cookie hooks, for the doctor.
 * The managed file as an earlier CLI wrote it is `detached` (`doctor --fix`
 * adds them). One the edit cannot place them in, a managed file changed by
 * hand or a proxy of the developer's own, is `unknown`: only the developer can.
 * Hooks from before ADR 083 are `outdated`: they keep the session in cookies
 * the server no longer reads.
 */
export function proxyConfSessionCookieVerdict(source: string): WiringVerdict {
  const text = lfText(source);
  if (text.includes(SESSION_COOKIE_MARKER)) {
    return "applied";
  }
  if (text.includes(SESSION_COOKIE_MARKER_V1)) {
    return {
      outdated: hasV1Hooks(text)
        ? "its session-cookie hooks name the session cookies before ADR 083; doctor --fix updates them"
        : "its session-cookie hooks name the session cookies before ADR 083 and were changed since zitadel setup wrote them, so they must be updated by hand",
    };
  }
  if (hasBearerOnlyHooks(text)) {
    return "detached";
  }
  return {
    unknown: text.includes(MANAGED_MARKER)
      ? "it was changed since zitadel setup wrote it, so the session-cookie hooks (ADR 073) must be added by hand"
      : "it is not the proxy zitadel setup writes, so the session-cookie hooks (ADR 073) must be added by hand",
  };
}

/**
 * Moves the managed proxy's bearer hook from v2, which knew only
 * `/sessions/exchange`, to v3, which knows the exchange under the API prefix
 * too (ADR 077): once an app's packages call `/api/v1`, a v2 proxy no longer
 * attaches the project secret to the exchange. Only the exact hook an earlier
 * CLI wrote is replaced; a file that carries v3 already, an unmanaged one and a
 * hook changed by hand are left as they are, and
 * {@link proxyConfApiPrefixVerdict} tells the doctor which it is. Line ends are
 * the file's own. Creates the managed proxy when it is absent, as
 * {@link proxyConfEdit} does.
 */
export function proxyConfApiPrefixEdit(): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      return proxyConfTemplate();
    }
    return withLfLineEnds(source, (text) =>
      text.includes(MANAGED_MARKER) && text.includes(V2_EXCHANGE_ONLY_BEARER)
        ? text.replace(V2_EXCHANGE_ONLY_BEARER, EXCHANGE_ONLY_BEARER)
        : text,
    );
  };
}

/**
 * Whether `proxy.conf.cjs` attaches the project secret to the exchange under
 * the API prefix too, for the doctor. The managed file with an earlier CLI's
 * v2 hook is `detached` (`doctor --fix` moves it to v3). A managed file whose
 * hook was changed by hand, and a proxy of the developer's own that attaches
 * the secret but never names `/api/v1/sessions/exchange`, are `unknown`: only
 * the developer can change them.
 */
export function proxyConfApiPrefixVerdict(source: string): WiringVerdict {
  const text = lfText(source);
  if (text.includes(EXCHANGE_ONLY_BEARER)) {
    return "applied";
  }
  if (text.includes(MANAGED_MARKER) && text.includes(V2_EXCHANGE_ONLY_BEARER)) {
    return "detached";
  }
  if (!text.includes("ZITADEL_PROJECT_SECRET") || text.includes(PREFIXED_EXCHANGE_PATH)) {
    return "applied";
  }
  return {
    unknown: text.includes(MANAGED_MARKER)
      ? `it was changed since zitadel setup wrote it, so its project-secret check must accept ${PREFIXED_EXCHANGE_PATH} by hand (ADR 077)`
      : `it is not the proxy zitadel setup writes, so its project-secret check must accept ${PREFIXED_EXCHANGE_PATH} by hand (ADR 077)`,
  };
}
