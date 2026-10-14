# @zitadel/sdk-sveltekit

SvelteKit handle hook and helpers for Nextgen Auth.

## Installation

```bash
pnpm add @zitadel/sdk-sveltekit
```

## Setup

### 1. Server hook

Create (or extend) `src/hooks.server.ts`:

```ts
import { createNextgenHandle } from '@zitadel/sdk-sveltekit/server';

export const handle = createNextgenHandle({
  url: process.env.ZITADEL_URL,
  projectSecret: process.env.ZITADEL_PROJECT_SECRET,
  protectedRoutes: ['/admin', '/dashboard*'],
  loginPath: '/login',
});
```

Read the config from `process.env` rather than SvelteKit's `$env` modules: the
public/private env import paths moved between SvelteKit 2 and 3
(`$env/dynamic/private` → `$app/env/private`), so `process.env` is the one
version-independent source. In dev, load `.env.local` first with
`process.loadEnvFile?.('.env.local')` (SvelteKit does not surface `.env` on
`process.env`); in production the platform provides the variables.

The hook runs on every request and does three things in one pass:

1. **Proxies** `/__nextgen/*` requests to the auth backend. The project secret
   is attached as the bearer only on the `POST /sessions/exchange` handoff, and
   never reaches the browser.
2. **Verifies** the session JWT via JWKS using the Web Crypto API and writes the
   result to `event.locals.nextgenAuth`.
3. **Redirects** unauthenticated requests to `loginPath` for protected routes.

Compose it with your existing hooks via `sequence()`:

```ts
import { sequence } from '@sveltejs/kit/hooks';
import { createNextgenHandle } from '@zitadel/sdk-sveltekit/server';

export const handle = sequence(createNextgenHandle({ /* … */ }), myOtherHandle);
```

### 2. Type the auth locals

`@zitadel/sdk-sveltekit/server` augments `App.Locals` with `nextgenAuth`
automatically. Make sure your `src/app.d.ts` keeps the `App` namespace:

```ts
declare global {
  namespace App {
    // nextgenAuth is merged in by @zitadel/sdk-sveltekit
    interface Locals {}
  }
}

export {};
```

### 3. Reading auth in a load function or endpoint

```ts
import { getAuth } from '@zitadel/sdk-sveltekit/server';
import { redirect } from '@sveltejs/kit';

export const load = (event) => {
  const auth = getAuth(event);
  if (!auth.isAuthenticated) throw redirect(302, '/login');
  // Forward only client-safe fields to the page — never the raw token.
  return { identifier: auth.session.identifier };
};
```

`protectedRoutes` guards full page loads (a direct visit or a reload): the hook
redirects before anything renders. Client-side navigation, such as following a
link to `/profile`, does not request the page from the server, so the hook does
not run. There the `ZitadelSession` card is the guard: when it finds no session
it navigates to its `postSignOutUrl`, so a signed-out visitor still ends at
`/login`.

To keep a page from rendering at all without a session, guard it on the server
with a load like the one above in its `+page.server.ts`. SvelteKit fetches that
load's data from the server on client-side navigation too, so the redirect runs
before the page renders either way:

```ts
// src/routes/profile/+page.server.ts
import { redirect } from '@sveltejs/kit';
import { getAuth } from '@zitadel/sdk-sveltekit/server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
  if (!getAuth(event).isAuthenticated) throw redirect(303, '/login');
};
```

A universal `+page.ts` load does not work for this: it runs in the browser on
client-side navigation, where the hook's `locals` are not available.

### 4. Render the login widget

Install the Svelte component library and render its `ZitadelLogin` component.
`@zitadel/sdk-sveltekit` is server-only; the widget comes from `@zitadel/sdk-svelte`:

```bash
pnpm add @zitadel/sdk-svelte
```

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { ZitadelLogin, configureZitadel } from '@zitadel/sdk-svelte';

  const project = configureZitadel({ projectId: 'demo', proxyPath: '/__nextgen' });

  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });
</script>

{#if mounted}
  <ZitadelLogin {project} purpose="login" postSignInUrl="/admin" />
{/if}
```

The widget mounts on the client only: its config is set as element properties,
which server-rendered markup cannot carry, so it is created in the browser with
its config in place. `onMount` never runs during SSR, and works
on SvelteKit 2 and 3 alike (`$app/environment` is deprecated in SvelteKit 3).

To read the project id from the environment, use Vite's
`import.meta.env.VITE_ZITADEL_PROJECT_ID`, which both SvelteKit majors expose to
the browser (`zitadel setup` seeds it in `.env.local`).

`ZitadelSession` renders the signed-in "signed in as" card with a sign-out
button, and `ZitadelLogout` a sign-out control on its own. Mount them the same
way:

```svelte
{#if mounted}
  <ZitadelSession {project} postSignOutUrl="/login" />
{/if}
```

The widgets' events surface as optional callbacks: `onFlowStep`, `onFlowInput`,
`onFlowComplete`, `onFlowRedirect` and `onFlowError` on `ZitadelLogin`, and
`onSignout` on `ZitadelLogout` and `ZitadelSession`. Pass
`locales={businessLocales}` (exported from `@zitadel/sdk-svelte`) to show
work-email copy for a business audience.

## Middleware options

| Option              | Type                 | Default              | Description                                                                                    |
| ------------------- | -------------------- | -------------------- | ---------------------------------------------------------------------------------------------- |
| `url`               | `string`             | `ZITADEL_URL` env    | Full URL of the Zitadel auth backend                                                           |
| `projectSecret`     | `string`             | `ZITADEL_PROJECT_SECRET` env | Project secret, sent as the bearer on the handoff exchange only (server-only)               |
| `proxyPath`         | `string`             | `"/__nextgen"`       | Path prefix proxied to the auth backend                                                        |
| `protectedRoutes`   | `string[]`           | `[]`                 | Paths requiring a valid session. Trailing `*` matches sub-paths                                |
| `ignoredRoutes`     | `string[]`           | `[]`                 | Paths skipped entirely — no JWT check. Trailing `*` matches sub-paths                          |
| `loginPath`         | `string`             | `"/login"`           | Where to redirect unauthenticated users                                                        |
| `allowedAlgorithms` | `string[]`           | `["RS256", "ES256"]` | JWT `alg` values to accept. Other algorithms are rejected before JWKS is fetched               |
| `allowedTokenTypes` | `string[]`           | `["JWT", "at+JWT"]`  | Accepted `typ` header values (case-insensitive). Set to `[]` to disable this check             |
| `clockSkewMs`       | `number`             | `5000`               | Clock skew tolerance in ms for `exp`, `nbf`, `iat`                                              |
| `jwksTimeoutMs`     | `number`             | `5000`               | Timeout in ms for JWKS endpoint requests                                                        |
| `proxyTimeoutMs`    | `number`             | `5000`               | Timeout in ms for upstream proxy requests                                                       |
| `audience`          | `string \| string[]` | not validated        | Expected `aud` claim value(s). When omitted, audience is not checked                           |

## How JWT verification works

1. Bearer token from `Authorization` header is checked first; `__nextgen_session` cookie is the fallback
2. Tokens with an `alg` not in `allowedAlgorithms` (`RS256`, `ES256` by default) are rejected before any JWKS fetch
3. Tokens with a `typ` not in `allowedTokenTypes` are rejected immediately
4. The public key is fetched from `{url}/auth/keys` (JWKS) via the Web Crypto API, cached for 5 minutes per `kid`
5. The signature is verified **before** any claim checks
6. `iss` must be present and must equal `url`
7. `exp` must be present and in the future (with `clockSkewMs` tolerance); `nbf` and `iat` are validated when present
8. Opaque (non-JWT) tokens fall back to validation via `GET /sessions/me`
