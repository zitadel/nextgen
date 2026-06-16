import { MANAGED_MARKER } from "../../../../paths";
import { PROXY_PATH } from "../proxy";

/**
 * The managed root component `src/app/app.ts`: a standalone component that
 * renders the `@zitadel/sdk-angular` widgets based on the current path. The
 * project id (public, not secret) is inlined; the dev proxy in `proxy.conf.cjs`
 * attaches the project service-key secret as the bearer server-side (read from
 * `.env.local`), and no secret reaches the browser.
 */
export function appComponentTemplate(projectId: string): string {
  return `${MANAGED_MARKER}
import { Component } from "@angular/core";
import {
  ZitadelLoginComponent,
  ZitadelLogoutComponent,
  configureZitadel,
} from "@zitadel/sdk-angular";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [ZitadelLoginComponent, ZitadelLogoutComponent],
  templateUrl: "./app.html",
})
export class App {
  protected readonly project = configureZitadel({
    projectId: ${JSON.stringify(projectId)},
    proxyPath: "${PROXY_PATH}",
  });
  protected readonly path = window.location.pathname;
}
`;
}

/**
 * The managed `src/app/app.html`. The marker lives in an HTML comment that still
 * contains the literal managed-marker text, so eject/doctor stay marker-aware.
 */
export function appTemplateHtml(): string {
  return `<!-- ${MANAGED_MARKER} -->
@if (path.startsWith('/profile')) {
  <zitadel-auth-logout [project]="project" postSignOutUrl="/login"></zitadel-auth-logout>
} @else if (path.startsWith('/register')) {
  <zitadel-auth-login
    [project]="project"
    purpose="register"
    postSignInUrl="/profile"
  ></zitadel-auth-login>
} @else {
  <zitadel-auth-login
    [project]="project"
    purpose="login"
    postSignInUrl="/profile"
  ></zitadel-auth-login>
}
`;
}

/**
 * The managed `proxy.conf.cjs` for `ng serve`: forwards `/__nextgen/*` to the
 * backend and attaches the project's service-key secret as the bearer on every
 * proxied request. Both the backend URL (`ZITADEL_URL`) and the secret
 * (`ZITADEL_PROJECT_SECRET`) are read from `.env.local`, which `zitadel setup`
 * writes and `.gitignore` excludes — Angular's CLI does not auto-load env files
 * into the dev-server process, so this file does it itself with a small inline
 * parser. The prefix strip and the bearer are each provided in both the
 * http-proxy-middleware form (`pathRewrite`/`onProxyReq`) and the Vite form
 * (`rewrite`/`configure`), so both fire whichever proxy layer Angular's
 * dev server uses.
 */
export function proxyConfTemplate(): string {
  return `${MANAGED_MARKER}
const { readFileSync, existsSync } = require("node:fs");

function loadEnvLocal() {
  if (!existsSync(".env.local")) return {};
  const out = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\\r?\\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^(['"])(.*)\\1$/, "$2");
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

function setBearer(proxyReq) {
  proxyReq.setHeader("authorization", bearer);
}

function stripPrefix(path) {
  return path.replace(/^\\${PROXY_PATH}/, "").replace(/^(?!\\/)/, "/");
}

module.exports = {
  "${PROXY_PATH}": {
    target: server,
    changeOrigin: false,
    pathRewrite: stripPrefix,
    rewrite: stripPrefix,
    onProxyReq: setBearer,
    configure: (proxy) => proxy.on("proxyReq", setBearer),
  },
};
`;
}
