import { createComponent } from '@lit/react';
import {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
} from '@zitadel/components';
import * as React from 'react';

/**
 * React components for the Zitadel auth widgets.
 *
 * These wrap the framework-agnostic Lit web components from
 * `@zitadel/components` with `@lit/react`'s `createComponent`, so they are real
 * React components: typed props, refs, and events, with the SDK `project`
 * handle bound as a DOM *property* (not an attribute) — which is what the
 * elements read at startup.
 *
 * In a client-side SPA, build the handle with `configureZitadel(...)` and pass
 * it as the `project` prop. Because the SPA renders after configuration, the
 * prop is present when the element upgrades:
 *
 * ```tsx
 * import { ZitadelLogin, configureZitadel } from "@zitadel/sdk-react";
 *
 * const project = configureZitadel({ projectId: "…", proxyPath: "/__nextgen" });
 *
 * export function LoginPage() {
 *   return <ZitadelLogin project={project} purpose="login" postSignInUrl="/" />;
 * }
 * ```
 */
export const ZitadelLogin = createComponent({
  react: React,
  tagName: 'zitadel-login',
  elementClass: ZitadelLoginElement,
});

export const ZitadelLogout = createComponent({
  react: React,
  tagName: 'zitadel-logout',
  elementClass: ZitadelLogoutElement,
});
