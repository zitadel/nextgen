import { MANAGED_MARKER } from "../../../../paths";

import type { PatchContext } from "../../types";
import { PROXY_PATH } from "../proxy";

// Enforce the dark surface the Zitadel widgets are designed for, so pages never
// follow the OS light/dark setting.
const WIDGET_WRAP = "position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark";

/**
 * `src/hooks.server.ts` — the SvelteKit server hook. `createNextgenHandle`
 * proxies `/__nextgen/*` to the auth backend (attaching the project service-key
 * from `ZITADEL_PROJECT_SECRET`), verifies the session JWT, and redirects
 * unauthenticated requests away from protected routes.
 *
 * The server config is read from `process.env`, not SvelteKit's `$env` modules:
 * their import path moved between major versions (`$env/dynamic/private` in
 * SvelteKit 2 is deprecated for `$app/env/private` in SvelteKit 3, and returns
 * empty values there), so a single template cannot use them and support both.
 * SvelteKit/Vite do not surface `.env` on `process.env`, so Node loads
 * `.env.local` here. The backend URL is baked as the fallback (the known
 * server from setup); in production the platform provides `ZITADEL_URL`. The
 * managed marker sits in a JS comment.
 */
export function hooksServerTemplate(ctx: PatchContext): string {
  return `${MANAGED_MARKER}
import { createNextgenHandle } from "@zitadel/sdk-sveltekit/server";

// Load .env.local into process.env (SvelteKit's $env modules differ across major
// versions; process.env is version-independent). Absent in production, where the
// platform provides the real environment.
try {
  process.loadEnvFile?.(".env.local");
} catch {
  // .env.local is optional — ignore when it does not exist.
}

export const handle = createNextgenHandle({
  url: process.env.ZITADEL_URL ?? ${JSON.stringify(ctx.server)},
  projectSecret: process.env.ZITADEL_PROJECT_SECRET,
  protectedRoutes: ["/profile"],
  loginPath: "/login",
});
`;
}

/**
 * `src/routes/+layout.svelte` — applies the dark surface to every page and
 * renders the routed page with Svelte 5's `{@render children()}`; `<slot />`
 * is deprecated there and warns on every dev start. The detectors refuse
 * Svelte 4, which the widget library does not support either.
 */
export function layoutTemplate(): string {
  return `<script lang="ts">
  ${MANAGED_MARKER}
  let { children } = $props();
</script>

{@render children()}

<style>
  :global(:root) {
    color-scheme: dark;
  }
  :global(body) {
    margin: 0;
    background: #0f0f11;
    color: #f4f4f6;
    font-family: sans-serif;
  }
</style>
`;
}

/** `src/routes/+page.svelte` — the landing chooser linking to login/register/profile. */
export function indexPageTemplate(): string {
  return `<!-- ${MANAGED_MARKER} -->
<main style="position:fixed;inset:0;padding:48px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;background:#0f0f11;color-scheme:dark;color:#f4f4f6;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5;letter-spacing:normal;text-align:center">
  <section style="width:100%;max-width:560px">
    <p style="margin:0 0 12px;color:#9ca3af;font-size:14px">Zitadel auth</p>
    <h1 style="margin:0 0 24px;font-size:32px;line-height:1.15;font-weight:600;color:#f4f4f6">Sign in, create an account, or open your profile.</h1>
    <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center">
      <a href="/login" style="padding:10px 16px;border-radius:8px;background:#f4f4f6;color:#0f0f11;text-decoration:none;font-weight:600;font-size:14px">Sign in</a>
      <a href="/register" style="padding:10px 16px;border-radius:8px;border:1px solid #3f3f46;color:#f4f4f6;text-decoration:none;font-weight:600;font-size:14px">Create account</a>
      <a href="/profile" style="padding:10px 16px;border-radius:8px;border:1px solid #3f3f46;color:#f4f4f6;text-decoration:none;font-weight:600;font-size:14px">Profile</a>
    </div>
  </section>
</main>
`;
}

/**
 * A login/register page. Renders the idiomatic `<ZitadelLogin>` Svelte component
 * from `@zitadel/sdk-svelte` (typed props, callback events) behind an `onMount`
 * guard so the widget only mounts on the client. `configureZitadel` returns the
 * project handle.
 *
 * The public project id is embedded directly rather than read from an `$env`
 * module: the location of SvelteKit's public-env import differs between major
 * versions (`$env/static/public` is deprecated in SvelteKit 3 in favour of
 * `$app/env/public`, and `$env/dynamic/public` does not surface the value in
 * every adapter), so a single template cannot import it and still support both
 * SvelteKit 2 and 3. The project id is public (not a secret — it reaches the
 * browser either way), and setup still writes `PUBLIC_ZITADEL_PROJECT_ID` to
 * `.env.local` for app code that prefers to read it from the environment.
 */
function authPage(purpose: "login" | "register", projectId: string): string {
  return `<script lang="ts">
  ${MANAGED_MARKER}
  import { onMount } from "svelte";
  import { ZitadelLogin, configureZitadel } from "@zitadel/sdk-svelte";

  const project = configureZitadel({
    projectId: ${JSON.stringify(projectId)},
    proxyPath: "${PROXY_PATH}",
  });
  // Mount the widget on the client only. onMount never runs during SSR, and
  // unlike $app/environment (deprecated in SvelteKit 3) it works on 2 and 3.
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });
</script>

<main style="${WIDGET_WRAP}">
  {#if mounted}
    <ZitadelLogin {project} purpose="${purpose}" postSignInUrl="/profile" />
  {/if}
</main>
`;
}

export function loginPageTemplate(projectId: string): string {
  return authPage("login", projectId);
}

export function registerPageTemplate(projectId: string): string {
  return authPage("register", projectId);
}

/** `src/routes/profile/+page.svelte` — the signed-in view: the "signed in as" session card, with sign-out. */
export function profilePageTemplate(projectId: string): string {
  return `<script lang="ts">
  ${MANAGED_MARKER}
  import { onMount } from "svelte";
  import { ZitadelSession, configureZitadel } from "@zitadel/sdk-svelte";

  const project = configureZitadel({
    projectId: ${JSON.stringify(projectId)},
    proxyPath: "${PROXY_PATH}",
  });
  // Mount the widget on the client only. onMount never runs during SSR, and
  // unlike $app/environment (deprecated in SvelteKit 3) it works on 2 and 3.
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });
</script>

<main style="${WIDGET_WRAP}">
  {#if mounted}
    <ZitadelSession {project} postSignOutUrl="/login" />
  {/if}
</main>
`;
}
