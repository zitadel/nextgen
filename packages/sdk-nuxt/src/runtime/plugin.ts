import { defineNuxtPlugin, useRequestEvent, useRuntimeConfig, useState } from "#imports";
import { configureZitadel } from "@zitadel/api/config";

import { resolveUrl } from "./lib/settings";
import type { ClientAuthResult } from "./types";

export default defineNuxtPlugin(() => {
  const event = useRequestEvent();
  const auth = event?.context.nextgenAuth ?? {
    isAuthenticated: false as const,
    session: null,
  };

  // Strip the raw JWT before seeding useState. The bearer token must not be
  // serialised into the Nuxt SSR payload (__NUXT__) where it would be exposed
  // to client-side JavaScript and third-party scripts. Vue components only
  // need userId / identifier / display — use getAuth(event) server-side when the
  // token itself is required (e.g. to forward it to an upstream API).
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
  // reading it in the browser makes Nuxt warn (NUXT_E1003). The browser has no
  // backend url: it reaches the backend through the proxy path.
  const privateConfig = import.meta.server ? runtimeConfig.nextgen : undefined;
  const url = import.meta.server ? resolveUrl(privateConfig) : undefined;

  if (proxyPath && projectId) {
    configureZitadel({ proxyPath, projectId, url });
  }
});
