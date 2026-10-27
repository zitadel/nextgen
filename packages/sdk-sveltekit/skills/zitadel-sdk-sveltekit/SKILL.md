---
name: zitadel-sdk-sveltekit
description: >-
  Integrate Zitadel authentication into an existing or custom SvelteKit app with
  @zitadel/sdk-sveltekit. Use when the user wants login, logout, session
  handling, or protected routes in a SvelteKit 3 app and is wiring the SDK
  by hand rather than letting the CLI scaffold a fresh project — adding the
  `handle` hook, reading auth state in a load function, or rendering the
  `ZitadelLogin` / `ZitadelSession` widgets.
---

# @zitadel/sdk-sveltekit

A SvelteKit `handle` hook and helpers that add Zitadel (Nextgen) auth to a
SvelteKit app. The hook proxies auth traffic same-origin under `/__nextgen`,
verifies the session JWT via JWKS on the server, writes the result to
`event.locals.nextgenAuth`, and redirects unauthenticated requests on protected
routes. The package is server-only; the widgets come from `@zitadel/sdk-svelte`.

## When to use

The `zitadel` CLI (`zitadel setup --framework sveltekit`) scaffolds the hook,
login/register/profile routes, `src/env.ts` and `.env.local` into a fresh or detected
SvelteKit project — prefer it for greenfield work. Reach for **this skill** when
you are adding auth to an **existing or custom** SvelteKit app by hand, or
adjusting a scaffolded wiring.

## Install

```bash
pnpm add @zitadel/sdk-sveltekit@latest
# the login/logout/session widgets are a separate package:
pnpm add @zitadel/sdk-svelte@latest
```

Peer deps: `@sveltejs/kit ^3.0.0`, `svelte ^5.0.0`.

## Integrate

**1. Server hook.** Declare the settings in `src/env.ts` (SvelteKit 3), so
SvelteKit serves them from the server-only `$app/env/private` — from
`.env.local` in dev, from the platform in production. An app that already
has `src/env.ts` adds the three entries to its own `defineEnvVars` call:

```ts
import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
  ZITADEL_URL: {},
  ZITADEL_PROJECT_SECRET: {},
  ZITADEL_PROJECT_ID: {},
});
```

Then create or extend `src/hooks.server.ts`:

```ts
import { ZITADEL_PROJECT_ID, ZITADEL_PROJECT_SECRET, ZITADEL_URL } from '$app/env/private';
import { createNextgenHandle } from '@zitadel/sdk-sveltekit/server';

export const handle = createNextgenHandle({
  url: ZITADEL_URL,
  projectSecret: ZITADEL_PROJECT_SECRET,
  projectId: ZITADEL_PROJECT_ID,
  protectedRoutes: ['/admin', '/dashboard*'], // trailing * matches sub-paths
  loginPath: '/login',
});
```

Do not read them from `process.env`: SvelteKit never puts `.env` files there.
Compose with other hooks via
`sequence()` from `@sveltejs/kit/hooks`. Sessions count only in the app's own
project: `projectId`, else `ZITADEL_PROJECT_ID`, else
`VITE_ZITADEL_PROJECT_ID`. With none set, nobody is signed in.

**2. Read auth server-side** with `getAuth(event)` in a load function or
endpoint, and forward only client-safe fields to the page — never the raw token:

```ts
import { redirect } from '@sveltejs/kit';
import { getAuth } from '@zitadel/sdk-sveltekit/server';

export const load = (event) => {
  const auth = getAuth(event);
  if (!auth.isAuthenticated) throw redirect(302, '/login');
  return { identifier: auth.session.identifier };
};
```

`protectedRoutes` only guards full page loads. To keep a page from rendering at
all without a session, guard it in a `+page.server.ts` load like the one above —
SvelteKit runs that load on the server for client-side navigation too. A
universal `+page.ts` load does not work: it runs in the browser, where `locals`
are not available.

**3. Render the widgets** from `@zitadel/sdk-svelte`, mounted on the client only
(set a flag in `onMount` and wrap the widget in `{#if mounted}`):

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { ZitadelLogin, configureZitadel } from '@zitadel/sdk-svelte';

  const project = configureZitadel({
    projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
    proxyPath: '/__nextgen',
  });

  let mounted = $state(false);
  onMount(() => (mounted = true));
</script>

{#if mounted}
  <ZitadelLogin {project} purpose="login" postSignInUrl="/admin" />
{/if}
```

`<ZitadelSession {project} postSignOutUrl="/login" />` renders the signed-in
card with sign-out, and `<ZitadelLogout>` a sign-out control on its own; mount
them the same way.

## Widget props and events

This SDK is server-only. The widgets come from `@zitadel/sdk-svelte`, so read its skill for the widget props and events.

## Read these, don't guess

The package README at `node_modules/@zitadel/sdk-sveltekit/README.md` and the
bundled `.d.ts` types (`dist/server.d.ts`, `dist/client.d.ts`) are authoritative
and versioned with the installed package — read them before wiring anything, and
let them override anything remembered. This skill teaches the pattern, not a
full catalog of options or the shared JWT-verification pipeline (that lives in
`@zitadel/sdk-core`). For widget props and callbacks, read
`node_modules/@zitadel/sdk-svelte/README.md` and its types. Check exact option
names and defaults against the installed version rather than assuming.

## Gotchas

- **`@zitadel/sdk-sveltekit` renders no widgets.** Importing `ZitadelLogin` from
  it fails; it comes from `@zitadel/sdk-svelte`.
- **Mount the widgets client-side only.** Their config is set as element
  properties, which server-rendered markup cannot carry; use `onMount`, not the
  deprecated `$app/environment` (SvelteKit 3).
- **Keep `App.Locals` declared.** The package merges `nextgenAuth` into it, so
  `src/app.d.ts` must keep the `App` namespace with a `Locals` interface.
- **Client-side navigation skips the hook.** Without a `+page.server.ts` guard,
  only the `ZitadelSession` card sends a signed-out visitor away.
