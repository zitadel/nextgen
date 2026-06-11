import { MANAGED_MARKER } from "../../../../paths";
import { PROXY_PATH } from "../vite-support";

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
 * Local-dev stand-in for `@zitadel/edge-proxy`: forwards `/__nextgen/*` to the
 * backend (read from `zitadel.json`), strips the prefix, and injects the project
 * service-key on `POST /sessions/exchange` (read from the gitignored
 * `.zitadel/secret`). Provides both `onProxyReq` (http-proxy-middleware) and
 * `configure` (Vite) hooks so whichever Angular's dev server honors will fire.
 */
export function proxyConfTemplate(): string {
  return `${MANAGED_MARKER}
const { readFileSync } = require("node:fs");

function backendTarget() {
  try {
    return JSON.parse(readFileSync("zitadel.json", "utf8")).server || "http://localhost:8080";
  } catch {
    return "http://localhost:8080";
  }
}

function injectBearer(proxyReq, req) {
  if (req.method === "POST" && String(req.url || "").includes("/sessions/exchange")) {
    try {
      const secret = JSON.parse(readFileSync(".zitadel/secret", "utf8")).project_secret;
      if (secret) {
        proxyReq.setHeader("authorization", "Bearer " + secret);
      }
    } catch {
      // secret not provisioned yet — leave the request unauthenticated
    }
  }
}

module.exports = {
  "${PROXY_PATH}": {
    target: backendTarget(),
    secure: false,
    changeOrigin: true,
    pathRewrite: { "^${PROXY_PATH}": "" },
    onProxyReq: injectBearer,
    configure: (proxy) => proxy.on("proxyReq", injectBearer),
  },
};
`;
}
