# @zitadel/sdk-qwik

Qwik components for the Zitadel auth UI, for client-side SPAs (Vite, etc.).

## Usage

```tsx
import { component$ } from '@builder.io/qwik';
import { ZitadelLogin, configureZitadel } from '@zitadel/sdk-qwik';

export default component$(() => {
  const project = configureZitadel({
    projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
    proxyPath: '/__nextgen',
  });

  return <ZitadelLogin project={project} purpose="login" postSignInUrl="/" />;
});
```

`<ZitadelLogout project={project} postSignOutUrl="/login" />` works the same way.

The widget's flow events are surfaced as optional QRL callbacks:
`onFlowStep$`, `onFlowInput$`, `onFlowComplete$`, and `onFlowError$`.

> The SDK binds `project` (and the discrete `projectId` / `proxyPath`) to the
> element as DOM properties, the same as the other framework SDKs.

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
