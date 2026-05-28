import {
  defineNuxtPlugin,
  useRequestEvent,
  useRuntimeConfig,
  useState,
} from '#imports';
import { configureZitadel } from '@zitadel-nextgen/api/config';

import type { ClientAuthResult } from './types';

export default defineNuxtPlugin(() => {
  const event = useRequestEvent();
  const auth = event?.context.nextgenAuth ?? {
    isAuthenticated: false as const,
    session: null,
  };

  // Strip the raw JWT before seeding useState. The bearer token must not be
  // serialised into the Nuxt SSR payload (__NUXT__) where it would be exposed
  // to client-side JavaScript and third-party scripts. Vue components only
  // need userId / email / name — use getAuth(event) server-side when the
  // token itself is required (e.g. to forward it to an upstream API).
  const clientAuth: ClientAuthResult = auth.isAuthenticated
    ? {
        isAuthenticated: true,
        session: {
          userId: auth.session.userId,
          email: auth.session.email,
          name: auth.session.name,
        },
      }
    : { isAuthenticated: false, session: null };

  useState<ClientAuthResult>('nextgen-auth', () => clientAuth);

  // Initialise SDK-wide config so web components (<zitadel-login>,
  // <zitadel-logout>) resolve apiBase and projectId from the shared
  // config instead of requiring per-instance attributes.
  const runtimeConfig = useRuntimeConfig();
  const publicConfig = runtimeConfig.public;
  const apiBase =
    (publicConfig.nextgenApiBase as string | undefined) ?? '/__nextgen';
  const projectId =
    (publicConfig.zitadelProjectId as string | undefined) ?? '';
  const issuerUrl =
    (runtimeConfig.nextgenIssuerUrl as string | undefined) ??
    'http://localhost:4000';

  if (apiBase && projectId) {
    configureZitadel({ apiBase, projectId, issuerUrl });
  }
});
