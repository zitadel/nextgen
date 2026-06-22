# @zitadel/sdk-vue

Vue 3 components for the Zitadel auth UI, for client-side SPAs (Vite, etc.).

## Requirements

TypeScript ≥ 5.0 — the published type definitions re-export with `export type *`, which TypeScript introduced in 5.0.

## Usage

```vue
<script setup lang="ts">
import { ZitadelLogin, configureZitadel } from '@zitadel/sdk-vue';

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: '/__nextgen',
});
</script>

<template>
  <ZitadelLogin :project="project" purpose="login" postSignInUrl="/" />
</template>
```

`<ZitadelLogout :project="project" postSignOutUrl="/login" />` works the same way.

## Proxying to the backend (deployment)

The widgets call `${proxyPath}/…` same-origin (default `/__nextgen`). A SPA has no
server, so on Vercel use `@zitadel/edge-proxy` to forward those calls:

```ts
// api/__nextgen/[...path].ts  (Vercel Edge Function)
import { handleProxy, resolveConfig } from '@zitadel/edge-proxy';
export const config = { runtime: 'edge' };
const proxyConfig = resolveConfig({
  apiUrl: process.env.NEXTGEN_API_URL ?? '',
});
export default (req: Request) => handleProxy(req, proxyConfig);
```

```json
// vercel.json
{
  "rewrites": [
    { "source": "/__nextgen/(.*)", "destination": "/api/__nextgen/$1" }
  ]
}
```

For local development you can skip the proxy and point `proxyPath` straight at the
backend (cross-origin), e.g. `proxyPath: "http://localhost:4000"`.
