import { MANAGED_MARKER } from "../../../../paths";
import { PROXY_PATH } from "../proxy";

/**
 * The managed root component `src/app/app.ts`: a standalone component that
 * renders the `@zitadel/sdk-angular` widgets based on the current path. The
 * project id (public, not secret) is inlined; the secret is injected by the dev
 * proxy in `proxy.conf.cjs` and never reaches the browser.
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
 * The managed `proxy.conf.cjs` for `ng serve` (Angular's Vite-based dev server).
 * `proxy.conf.cjs` for `ng serve`: forwards `/__nextgen/*` to the backend (from
 * `zitadel.json`), strips the prefix, and attaches the project's `sk_<project_id>`
 * bearer to every proxied request. Both `onProxyReq` (http-proxy-middleware) and
 * `configure` (Vite) hooks are set so whichever Angular's dev server honors fires.
 */
export function proxyConfTemplate(): string {
  return `${MANAGED_MARKER}
const { readFileSync } = require("node:fs");

const config = JSON.parse(readFileSync("zitadel.json", "utf8"));
const bearer = \`Bearer sk_\${config.project}\`;

function setBearer(proxyReq) {
  proxyReq.setHeader("authorization", bearer);
}

module.exports = {
  "${PROXY_PATH}": {
    target: config.server,
    changeOrigin: false,
    pathRewrite: (path) => path.replace(/^\\${PROXY_PATH}/, "") || "/",
    onProxyReq: setBearer,
    configure: (proxy) => proxy.on("proxyReq", setBearer),
  },
};
`;
}
