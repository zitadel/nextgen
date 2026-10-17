---
name: zitadel-sdk-svelte
description: >-
  Integrate Zitadel authentication into an existing Svelte or SvelteKit app
  with the @zitadel/sdk-svelte components. Use when the user wants to add login,
  logout, or a signed-in session card to a Svelte 5 / SvelteKit (or Vite SPA)
  project by hand, wire the auth widgets to a backend, or debug the proxy and
  post sign-in/out redirects.
---

# @zitadel/sdk-svelte

`@zitadel/sdk-svelte` ships Svelte 5 components that render the Zitadel auth UI
(`<ZitadelLogin>`, `<ZitadelLogout>`, `<ZitadelSession>`) for client-side SPAs.
The components wrap the `@zitadel/components` custom elements and talk to a
Zitadel backend over a same-origin proxy path.

## When to use

Use this skill for an **existing or custom** Svelte / SvelteKit / Vite app where
you are adding the auth widgets by hand.

If the user is starting fresh, prefer the `zitadel` CLI instead — it scaffolds a
working Svelte app and wires the dev proxy for you:

```sh
npx @zitadel/cli@alpha setup --framework svelte --non-interactive --json
```

## Install

```sh
npm install @zitadel/sdk-svelte@alpha
```

Requires Svelte `^5.0.0` (peer dependency) and TypeScript `>= 5.0` — the
published types use `export type *`.

## Integrate

The widgets are **browser** components: the package ships client-compiled
Svelte, so server rendering them fails. In a Vite SPA, render them directly. In
SvelteKit, where a `+page.svelte` also renders on the server, mount them after
`onMount`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { ZitadelLogin, ZitadelLogout, configureZitadel } from '@zitadel/sdk-svelte';

  const project = configureZitadel({
    projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
    proxyPath: '/__nextgen',
  });

  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });
</script>

{#if mounted}
  <ZitadelLogin {project} purpose="login" postSignInUrl="/" />
  <ZitadelLogout {project} postSignOutUrl="/login" />
{/if}
```

- **Configure once** with `configureZitadel({ projectId, proxyPath })` and pass
  the returned `project` to each component.
- **Proxy / same-origin.** The widgets call `${proxyPath}/…` same-origin
  (default `/__nextgen`). For local development you can skip the proxy and point
  `proxyPath` straight at the backend (cross-origin), e.g.
  `proxyPath: "http://localhost:8080"` (the `zitadel start` default port).
- **Post URLs.** `postSignInUrl` (on `ZitadelLogin`) and `postSignOutUrl` (on
  `ZitadelLogout`) are where the browser lands after each flow.
- **Session card.** `<ZitadelSession {project} />` renders the signed-in user.
- **No session.** When the visitor has no session, the session widgets render nothing and call
  `onSessionMissing`; the session card also goes to its `postSignOutUrl` (unless that is the page it
  is on), so point it at the login page. Any other failure (a 5xx, a network
  error) keeps the widget, shows the error and calls `onSessionError`.
- **Event callbacks** are optional `on…` props (for example `onFlowComplete`
  on the login, `onSignout` on logout and the session card); the README and the
  types list them all.

## Read these, don't guess

The installed package is authoritative — it and this skill version independently,
so discover against what is installed rather than trusting anything hardcoded
here:

- `node_modules/@zitadel/sdk-svelte/README.md` — the shipped usage doc.
- `node_modules/@zitadel/sdk-svelte/dist/index.d.ts` and the component prop
  types (`ZitadelLoginProps`, `ZitadelLogoutProps`, re-exported from
  `@zitadel/sdk-core/types`) — the exact props, their names, and which are
  optional. Read the types before passing a prop you are unsure of.

The public exports are `ZitadelLogin`, `ZitadelLogout`, `ZitadelSession`,
`configureZitadel`, `getApi`, `getZitadelConfig`, `businessLocales`, plus the
`ZitadelConfig` / `ZitadelProject` types.

## Gotchas

- **Production SPA deployment is not yet supported.** The same-origin proxy path
  must come from your hosting platform, and the CLI cannot scaffold those configs
  yet (see ADR 036 and zitadel/nextgen#560). The CLI dev proxy covers local
  development only.
- **`proxyPath` must reach the backend.** A same-origin path needs a proxy in
  front of your app; without one, point `proxyPath` at the backend origin
  directly (dev only, cross-origin).
- **Browser-only.** The components render the auth UI client-side; under
  SvelteKit, gate them behind `onMount` as shown above.
