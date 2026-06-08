# @zitadel/sdk-react

React components for the Zitadel auth UI, for client-side SPAs.

## Usage

```tsx
import {
  ZitadelLogin,
  ZitadelLogout,
  configureZitadel,
} from '@zitadel/sdk-react';

// Configure once, before rendering. The handle is passed to the widget as a
// prop, so it has config the moment it mounts.
const project = configureZitadel({
  projectId: '<your project id>', // e.g. from your bundler's env (import.meta.env, process.env, …)
  proxyPath: '/__nextgen', // same-origin path your deploy proxies to the backend
});

export function LoginPage() {
  return <ZitadelLogin project={project} purpose="login" postSignInUrl="/" />;
}

export function ProfilePage() {
  return <ZitadelLogout project={project} postSignOutUrl="/login" />;
}
```

## Proxying to the backend (deployment)

The widgets call `${proxyPath}/…` same-origin (default `/__nextgen`). A SPA has no
server, so on Vercel (and Cloudflare/Netlify) use `@zitadel/edge-proxy` to forward
those calls to your Zitadel backend:

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

For local development you can skip the proxy entirely and point `proxyPath` straight
at the backend (cross-origin), e.g. `proxyPath: "http://localhost:4000"`.
