import { defineNuxtPlugin, useRequestEvent, useRuntimeConfig, useState } from "#imports";
import { configureZitadel } from "@zitadel/api/config";

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
    : // An outage keeps its reason, so a page guard can tell it from signed out.
      auth.reason
      ? { isAuthenticated: false, session: null, reason: auth.reason }
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
  // `nextgen` is private runtime config (it holds the project secret), so it
  // exists only on the server. Reading it in the browser makes Nuxt warn
  // (NUXT_E1003) and advise making it public, which would ship the secret.
  // The browser handle only needs the proxy path; the URL is read where there
  // is a request, i.e. on the server.
  const url = event
    ? ((runtimeConfig.nextgen?.url as string | undefined) ??
      (runtimeConfig.nextgen?.issuerUrl as string | undefined) ??
      "http://localhost:8080")
    : undefined;

  if (proxyPath && projectId) {
    configureZitadel({ proxyPath, projectId, ...(url ? { url } : {}) });
  }
});
