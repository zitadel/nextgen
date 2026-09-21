import { defineNuxtPlugin, useRequestEvent, useState } from "#imports";
import type { ClientAuthResult } from "@zitadel/sdk-nuxt";

export default defineNuxtPlugin(() => {
  const event = useRequestEvent();
  const auth = event?.context.nextgenAuth ?? {
    isAuthenticated: false as const,
    session: null,
  };

  // Strip the raw JWT before seeding useState — it must not appear in the
  // Nuxt SSR payload where client-side scripts could read it.
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
});
