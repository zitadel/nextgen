# @zitadel/sdk-solid

Solid components for the Zitadel auth UI, for client-side SPAs (Vite, etc.).

## Requirements

TypeScript ≥ 5.0 — the published type definitions re-export with `export type *`, which TypeScript introduced in 5.0.

## Usage

```tsx
import { ZitadelLogin, configureZitadel } from '@zitadel/sdk-solid';

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: '/__nextgen',
});

export default function LoginPage() {
  return <ZitadelLogin project={project} purpose="login" postSignInUrl="/" />;
}
```

`<ZitadelLogout project={project} postSignOutUrl="/login" />` works the same way.

The widget's flow events are also surfaced as optional callbacks:
`onFlowStep`, `onFlowInput`, `onFlowComplete`, and `onFlowError`.

## Proxying to the backend (deployment)

The widgets call `${proxyPath}/…` same-origin (default `/__nextgen`). A SPA has no
server, so in production the path comes from your hosting platform — a
`vercel.json` rewrite, a `netlify.toml` redirect, or a minimal Cloudflare
worker — with no secrets on the platform, per
[ADR 036](https://github.com/zitadel/nextgen/blob/main/docs/adrs/036-api-credential-planes.md).
CLI scaffolding for these configs is tracked in
[zitadel/nextgen#560](https://github.com/zitadel/nextgen/issues/560). **Until
that work lands, production SPA deployment is not yet supported** — the CLI dev
proxy covers local development.

For local development you can skip the proxy and point `proxyPath` straight at the
backend (cross-origin), e.g. `proxyPath: "http://localhost:4000"`.
