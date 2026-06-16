import { MANAGED_MARKER } from "../../../../paths";

const MAIN_STYLE =
  "min-height: 100vh; background: #0f0f11";

/** `app.vue` — renders the page router. Marker in an HTML comment. */
export function appVueTemplate(): string {
  return `<!-- ${MANAGED_MARKER} -->
<template>
  <NuxtPage />
</template>

<style>
body {
  margin: 0;
  font-family: sans-serif;
}
</style>
`;
}

/** A login/register page rendering `<zitadel-login>` inside `<ClientOnly>`. */
function authPage(purpose: "login" | "register"): string {
  const purposeAttr = purpose === "register" ? '\n        purpose="register"' : "";
  return `<script setup lang="ts">
${MANAGED_MARKER}
import { useZitadelProject } from "@zitadel/sdk-nuxt";

const project = useZitadelProject();
</script>

<template>
  <main style="${MAIN_STYLE}">
    <ClientOnly>
      <zitadel-login
        :project="project"${purposeAttr}
        post-sign-in-url="/profile"
      />
    </ClientOnly>
  </main>
</template>
`;
}

export function loginPageTemplate(): string {
  return authPage("login");
}

export function registerPageTemplate(): string {
  return authPage("register");
}

/** `pages/profile.vue` — the signed-in view with the logout widget. */
export function profilePageTemplate(): string {
  return `<script setup lang="ts">
${MANAGED_MARKER}
import { useZitadelProject } from "@zitadel/sdk-nuxt";

const project = useZitadelProject();
</script>

<template>
  <main style="padding: 24px">
    <h1>Signed in (Nuxt)</h1>
    <ClientOnly>
      <zitadel-logout :project="project" post-sign-out-url="/login" />
    </ClientOnly>
  </main>
</template>
`;
}

/** `plugins/zitadel-components.client.ts` — register the Lit elements client-side. */
export function componentsPluginTemplate(): string {
  return `${MANAGED_MARKER}
// Register Lit custom elements on the client only. Importing @zitadel/components
// from a page <script setup> would run during SSR and break the widgets.
import "@zitadel/components";

export default defineNuxtPlugin(() => {});
`;
}

/** `plugins/auth.server.ts` — seed the client auth state from the server context. */
export function authPluginTemplate(): string {
  return `${MANAGED_MARKER}
import { defineNuxtPlugin, useRequestEvent, useState } from "#imports";
import type { ClientAuthResult } from "@zitadel/sdk-nuxt";

export default defineNuxtPlugin(() => {
  const event = useRequestEvent();
  const auth = event?.context.nextgenAuth ?? {
    isAuthenticated: false as const,
    session: null,
  };

  // Strip the raw JWT before seeding useState — it must not appear in the SSR
  // payload where client-side scripts could read it.
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

  useState<ClientAuthResult>("nextgen-auth", () => clientAuth);
});
`;
}
