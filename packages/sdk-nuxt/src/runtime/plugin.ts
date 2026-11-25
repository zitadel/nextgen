import { defineNuxtPlugin, useRequestEvent, useRuntimeConfig, useState } from "#imports";
import { configureZitadel } from "@zitadel/api/config";

import { DEFAULT_URL, resolveUrl } from "./lib/settings";
import type { ClientAuthResult } from "./types";

/**
 * The universal Nuxt plugin that seeds the auth state and configures the API client.
 *
 * On the server it reads the session the middleware stored on the request and copies it into the
 * state behind `useAuth()` with the raw token removed, so the signed-in state hydrates in the
 * browser without the bearer token entering the server-rendered payload, where scripts on the page
 * could read it. It then calls `configureZitadel` with the proxy path, project id and backend URL,
 * so the widgets and `useZitadelApi()` find the proxy and the project without per-element
 * attributes. Configuration is skipped when either the proxy path or the project id is empty.
 *
 * The proxy path comes from `runtimeConfig.public.zitadelProxyPath`, then `nextgenProxyPath`, then
 * `nextgenApiBase`, then `/__nextgen`. The private `runtimeConfig.nextgen` exists only on the
 * server, so the browser uses the default backend URL instead of reading it, which Nuxt would warn
 * about.
 *
 * The module registers this plugin. An app does not import it.
 */
export default defineNuxtPlugin(() => {
  const event = useRequestEvent();
  const auth = event?.context.nextgenAuth ?? {
    isAuthenticated: false as const,
    session: null,
  };

  // Strip the raw JWT before seeding useState. The bearer token must not be
  // serialised into the Nuxt SSR payload (__NUXT__) where it would be exposed
  // to client-side JavaScript and third-party scripts. Vue components only
  // need userId / identifier / display; use getAuth(event) server-side when the
  // token itself is required.
  const clientAuth: ClientAuthResult = auth.isAuthenticated
    ? {
        isAuthenticated: true,
        session: {
          userId: auth.session.userId,
          identifier: auth.session.identifier,
          identifierProperty: auth.session.identifierProperty,
          display: auth.session.display,
        },
      }
    : { isAuthenticated: false, session: null };

  useState<ClientAuthResult>("nextgen-auth", () => clientAuth);

  // Initialise SDK-wide config so web components (<zitadel-login>,
  // <zitadel-logout>) resolve proxyPath and projectId from the shared
  // config instead of requiring per-instance attributes.
  const runtimeConfig = useRuntimeConfig();
  const publicConfig = runtimeConfig.public;
  const proxyPath =
    (publicConfig.zitadelProxyPath as string | undefined) ??
    (publicConfig.nextgenProxyPath as string | undefined) ??
    (publicConfig.nextgenApiBase as string | undefined) ??
    "/__nextgen";
  const projectId = (publicConfig.zitadelProjectId as string | undefined) ?? "";
  // `runtimeConfig.nextgen` is private, so it exists only on the server;
  // reading it in the browser makes Nuxt warn (NUXT_E1003). The browser keeps
  // the default, as it always did.
  const privateConfig = import.meta.server ? runtimeConfig.nextgen : undefined;
  const url = import.meta.server ? resolveUrl(privateConfig) : DEFAULT_URL;

  if (proxyPath && projectId) {
    configureZitadel({ proxyPath, projectId, url });
  }
});
