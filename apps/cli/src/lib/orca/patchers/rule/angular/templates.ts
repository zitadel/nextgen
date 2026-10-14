import { MANAGED_MARKER } from "../../../../paths";
import type { PatchContext } from "../../types";
import { PROXY_PATH } from "../proxy";
import {
  assertNoUnreviewedProjectSecretProxy,
  PROXY_CREDENTIAL_POLICY_MARKER,
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
import { isPlatformBrowser, PlatformLocation } from "@angular/common";
import { Component, inject, OnInit, PLATFORM_ID } from "@angular/core";
import {${importNames}} from "@zitadel/sdk-angular";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [ZitadelLoginComponent, ZitadelSessionComponent],
  templateUrl: "./app.html",
})
export class App implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  protected readonly project = configureZitadel({
    projectId: ${JSON.stringify(ctx.project.id)},
    proxyPath: "${PROXY_PATH}",
  });
  // PlatformLocation reads the browser's URL, or the request's when the app
  // is server-rendered with @angular/ssr, which has no window object.
  protected readonly path = inject(PlatformLocation).pathname;${localesProperty}

  ngOnInit(): void {
    if (this.path === "/" && isPlatformBrowser(this.platformId)) {
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
 * `X-Forwarded-Proto` (`xfwd`).
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
    onProxyReq: setBearer,
    configure: (proxy) => proxy.on("proxyReq", setBearer),
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
    if (source.includes(MANAGED_MARKER) && source.includes(LEGACY_UNCONDITIONAL_BEARER)) {
      return forwardAppOrigin(source.replace(LEGACY_UNCONDITIONAL_BEARER, EXCHANGE_ONLY_BEARER));
    }
    assertNoUnreviewedProjectSecretProxy(source, "proxy.conf.cjs");
    return source.includes(MANAGED_MARKER) ? forwardAppOrigin(source) : source;
  };
}
