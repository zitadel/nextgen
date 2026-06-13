import { MANAGED_MARKER } from "../../../../paths";
import { PROXY_PATH } from "../proxy";

/**
 * The managed root component `src/app/app.ts`: a standalone component that
 * renders the `@zitadel/sdk-angular` widgets based on the current path. The
 * project id (public, not secret) is inlined; the dev proxy in `proxy.conf.cjs`
 * attaches the `sk_<project_id>` bearer (derived from that public id)
 * server-side, and no secret reaches the browser.
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
 * backend (from `zitadel.json`), strips the prefix, and attaches the project's
 * `sk_<project_id>` bearer to every proxied request. The prefix strip and the
 * bearer are each provided in both the http-proxy-middleware form
 * (`pathRewrite`/`onProxyReq`) and the Vite form (`rewrite`/`configure`), so
 * both fire whichever proxy layer Angular's dev server uses.
 */
export function proxyConfTemplate(): string {
  return `${MANAGED_MARKER}
const { readFileSync } = require("node:fs");

const config = JSON.parse(readFileSync("zitadel.json", "utf8"));
if (!config.project || !config.server) {
  throw new Error("zitadel.json is missing \\"project\\" or \\"server\\"; re-run zitadel setup.");
}
const bearer = \`Bearer sk_\${config.project}\`;

function setBearer(proxyReq) {
  proxyReq.setHeader("authorization", bearer);
}

function stripPrefix(path) {
  return path.replace(/^\\${PROXY_PATH}/, "").replace(/^(?!\\/)/, "/");
}

module.exports = {
  "${PROXY_PATH}": {
    target: config.server,
    changeOrigin: false,
    pathRewrite: stripPrefix,
    rewrite: stripPrefix,
    onProxyReq: setBearer,
    configure: (proxy) => proxy.on("proxyReq", setBearer),
  },
};
`;
}
