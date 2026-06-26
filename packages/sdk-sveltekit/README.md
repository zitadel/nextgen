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
import { env } from '$env/dynamic/private';

export const handle = createNextgenHandle({
  url: env.ZITADEL_URL,
  projectSecret: env.ZITADEL_PROJECT_SECRET,
  protectedRoutes: ['/admin', '/dashboard*'],
  loginPath: '/login',
});
```

The hook runs on every request and does three things in one pass:

1. **Proxies** `/__nextgen/*` requests to the auth backend, attaching the
   project service-key as the bearer (the secret never reaches the browser).
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
  return { email: auth.session.email };
};
```

### 4. Render the login widget

Install the Svelte component library and render its `ZitadelLogin` component.
`@zitadel/sdk-sveltekit` is server-only; the widget comes from `@zitadel/sdk-svelte`:

```bash
pnpm add @zitadel/sdk-svelte
```

```svelte
<script lang="ts">
  import { browser } from '$app/environment';
  import { ZitadelLogin, configureZitadel } from '@zitadel/sdk-svelte';

  const project = configureZitadel({ projectId: 'demo', proxyPath: '/__nextgen' });
</script>

{#if browser}
  <ZitadelLogin {project} purpose="login" postSignInUrl="/admin" />
{/if}
```

## Middleware options

| Option              | Type                 | Default              | Description                                                                                    |
| ------------------- | -------------------- | -------------------- | ---------------------------------------------------------------------------------------------- |
| `url`               | `string`             | `ZITADEL_URL` env    | Full URL of the Zitadel auth backend                                                           |
| `projectSecret`     | `string`             | `ZITADEL_PROJECT_SECRET` env | Project service-key sent as the bearer on proxied requests (server-only)               |
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
