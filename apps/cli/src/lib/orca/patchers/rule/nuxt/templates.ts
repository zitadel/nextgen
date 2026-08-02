import { MANAGED_MARKER } from "../../../../paths";
import type { PatchContext } from "../../types";

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

/**
 * A login/register page rendering `<zitadel-login>` inside `<ClientOnly>`.
 * Business-use-case projects additionally bind the SDK's `businessLocales`
 * overlay, restoring work-email copy on top of the widget's neutral built-in
 * dictionaries. A plain `:locales` binding suffices even on the raw custom
 * element: Vue sets bindings whose key exists on the element as DOM
 * properties (unlike React 18, which is why the Next template needs a ref).
 */
function authPage(purpose: "login" | "register", ctx: PatchContext): string {
  const business = ctx.useCase === "business";
  const importNames = business ? "businessLocales, useZitadelProject" : "useZitadelProject";
  // The overlay ships with the SDK, so the generated page only wires it up
  // (and stays plain otherwise).
  const localesComment = business
    ? `
// Set up for a business audience: businessLocales overlays work-email copy on
// the login widget's neutral built-in dictionaries. Remove the :locales
// binding to fall back to the neutral wording.`
    : "";
  const localesAttr = business ? '\n        :locales="businessLocales"' : "";
  const purposeAttr = purpose === "register" ? '\n        purpose="register"' : "";
  // variant="page" makes the widget paint the full-page chrome itself
  // (viewport height, surface background) from design tokens; the <main>
  // wrapper only pins the color scheme.
  return `<script setup lang="ts">
${MANAGED_MARKER}
import { ${importNames} } from "@zitadel/sdk-nuxt";${localesComment}

const project = useZitadelProject();
</script>

<template>
  <main style="color-scheme: dark">
    <ClientOnly>
      <!-- variant="page" paints the widget's full-page chrome from design
           tokens; variant="widget" embeds the card inside a layout you own. -->
      <zitadel-login
        variant="page"
        :project="project"${localesAttr}${purposeAttr}
        post-sign-in-url="/profile"
      />
    </ClientOnly>
  </main>
</template>
`;
}

export function loginPageTemplate(ctx: PatchContext): string {
  return authPage("login", ctx);
}

export function registerPageTemplate(ctx: PatchContext): string {
  return authPage("register", ctx);
}

/** `pages/profile.vue` — the post-sign-in "signed in as" session card. */
export function profilePageTemplate(): string {
  return `<script setup lang="ts">
${MANAGED_MARKER}
import { useZitadelProject } from "@zitadel/sdk-nuxt";

const project = useZitadelProject();
</script>

<template>
  <main style="color-scheme: dark">
    <ClientOnly>
      <!-- variant="page" paints the session card's full-page chrome from design
           tokens; variant="widget" embeds the card inside a layout you own.
           Your own components (a header, an account menu) read the same session
           state with the auto-imported useAuth() composable. -->
      <zitadel-session variant="page" :project="project" post-sign-out-url="/login" />
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
