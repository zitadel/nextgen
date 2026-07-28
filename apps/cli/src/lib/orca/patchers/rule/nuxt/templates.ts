import { MANAGED_MARKER } from "../../../../paths";

// Enforce the dark surface the Zitadel widgets are designed for, so pages never
// follow the OS light/dark setting.
const MAIN_STYLE =
  "min-height: 100vh; background: #0f0f11; color: #f4f4f6; color-scheme: dark";

/** `app.vue` — renders the page router. Marker in an HTML comment. */
export function appVueTemplate(): string {
  return `<!-- ${MANAGED_MARKER} -->
<template>
  <NuxtPage />
</template>

<style>
:root {
  color-scheme: dark;
}
body {
  margin: 0;
  background: #0f0f11;
  color: #f4f4f6;
  font-family: sans-serif;
}
</style>
`;
}

/** `pages/index.vue` — redirects the app root to `/login`. */
export function indexPageTemplate(): string {
  return `<script setup lang="ts">
${MANAGED_MARKER}
await navigateTo("/login", { replace: true });
</script>
`;
}

/** A login/register page rendering `<zitadel-login>` inside `<ClientOnly>`. */
function authPage(purpose: "login" | "register"): string {
  const purposeAttr = purpose === "register" ? '\n        purpose="register"' : "";
  // variant="page" makes the widget paint the full-page chrome itself
  // (viewport height, surface background) from design tokens; the <main>
  // wrapper only pins the color scheme.
  return `<script setup lang="ts">
${MANAGED_MARKER}
import { useZitadelProject } from "@zitadel/sdk-nuxt";

const project = useZitadelProject();
</script>

<template>
  <main style="color-scheme: dark">
    <ClientOnly>
      <zitadel-login
        variant="page"
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

/** `pages/profile.vue` — the post-sign-in "signed in as" session card. */
export function profilePageTemplate(): string {
  return `<script setup lang="ts">
${MANAGED_MARKER}
import { useZitadelProject } from "@zitadel/sdk-nuxt";

const project = useZitadelProject();
</script>

<template>
  <main style="${MAIN_STYLE}">
    <ClientOnly>
      <zitadel-session :project="project" post-sign-out-url="/login" />
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
