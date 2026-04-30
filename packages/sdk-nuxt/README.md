# @nextgen/sdk-nuxt

Nuxt middleware and helpers for Nextgen Auth.

## Installation

```bash
pnpm add @nextgen/sdk-nuxt
```

## Setup

### 1. Server middleware

Create `server/middleware/auth.ts`:

```ts
import { createNextgenMiddleware } from '@nextgen/sdk-nuxt/server';

const { nextgenIssuerUrl } = useRuntimeConfig();

export default createNextgenMiddleware({
  issuerUrl: nextgenIssuerUrl as string,
  protectedRoutes: ['/admin', '/dashboard*'],
  loginPath: '/login',
});
```

The middleware runs on every request and does three things in one pass:

1. **Proxies** `/__nextgen/*` requests to the auth backend
2. **Verifies** the session JWT via JWKS using the Web Crypto API
3. **Redirects** unauthenticated requests to `loginPath` for protected routes

Add the issuer URL to `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  runtimeConfig: {
    nextgenIssuerUrl: process.env.NEXTGEN_ISSUER_URL ?? 'http://localhost:4000',
  },
});
```

### 2. Plugin

Create `plugins/auth.server.ts` to make auth state available in pages:

```ts
import { defineNuxtPlugin, useRequestEvent, useState } from '#imports';

export default defineNuxtPlugin(() => {
  const event = useRequestEvent();
  const auth = event?.context.nextgenAuth ?? {
    isAuthenticated: false as const,
    session: null,
  };
  useState('nextgen-auth', () => auth);
});
```

### 3. Reading auth in a page

```vue
<script setup lang="ts">
const auth = useState('nextgen-auth');
if (auth.value?.isAuthenticated) {
  await navigateTo('/admin');
}
</script>

<template>
  <p>{{ auth.isAuthenticated ? auth.session.email : 'Not signed in' }}</p>
</template>
```

### 4. Login page

The `<nextgen-login>` web component must be rendered client-side only. Use `<ClientOnly>`:

```vue
<template>
  <main>
    <ClientOnly>
      <nextgen-login proxy-base="/__nextgen" @nextgen-signin="onSignIn" />
    </ClientOnly>
  </main>
</template>

<script setup lang="ts">
import '@nextgen/ui-lit';

function onSignIn() {
  navigateTo('/admin');
}
</script>
```

### 5. Reading auth in a server route

```ts
import { getAuth } from '@nextgen/sdk-nuxt/server';

export default defineEventHandler((event) => {
  const auth = getAuth(event);
  if (!auth.isAuthenticated) throw createError({ statusCode: 401 });
  return { userId: auth.session.userId };
});
```

## Middleware options

| Option              | Type       | Default                  | Description                                                                                                                |
| ------------------- | ---------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `issuerUrl`         | `string`   | `NEXTGEN_ISSUER_URL` env | Full URL of the Nextgen auth backend                                                                                       |
| `proxyPath`         | `string`   | `"/__nextgen"`           | Path prefix proxied to the auth backend                                                                                    |
| `protectedRoutes`   | `string[]` | `[]`                     | Paths requiring a valid session. Trailing `*` matches sub-paths                                                            |
| `ignoredRoutes`     | `string[]` | `[]`                     | Paths skipped entirely — no JWT check, no tunnelling. Useful for webhooks or health checks. Trailing `*` matches sub-paths |
| `loginPath`         | `string`   | `"/login"`               | Where to redirect unauthenticated users                                                                                    |
| `allowedAlgorithms` | `string[]` | all accepted             | JWT `alg` values to accept (e.g. `["RS256"]`)                                                                              |
| `clockSkewMs`       | `number`   | `5000`                   | Clock skew tolerance in ms for `exp`, `nbf`, `iat`                                                                         |

## How JWT verification works

1. Bearer token from `Authorization` header is checked first; `__nextgen_session` cookie is the fallback
2. The JWT header is decoded to extract `kid` and `alg`
3. The public key is fetched from `{issuerUrl}/oauth/v2/keys` (JWKS) using the Web Crypto API and cached for 5 minutes per `kid`
4. The signature is verified **before** any claim checks
5. `exp`, `nbf`, and `iat` are validated with the configured clock skew tolerance
