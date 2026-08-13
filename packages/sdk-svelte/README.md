# @zitadel/sdk-svelte

Svelte 5 components for the Zitadel auth UI, for client-side SPAs (Vite, etc.).

## Requirements

TypeScript ≥ 5.0 — the published type definitions re-export with `export type *`, which TypeScript introduced in 5.0.

## Usage

```svelte
<script lang="ts">
  import { ZitadelLogin, configureZitadel } from '@zitadel/sdk-svelte';

  const project = configureZitadel({
    projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
    proxyPath: '/__nextgen',
  });
</script>

<ZitadelLogin {project} purpose="login" postSignInUrl="/" />
```

`<ZitadelLogout {project} postSignOutUrl="/login" />` works the same way.

The signed-in session card is `<ZitadelSession {project} />` (exported as `ZitadelSession`).

The widget's flow events are also surfaced as optional callbacks:
`onFlowStep`, `onFlowInput`, `onFlowComplete`, and `onFlowError`.

## Proxying to the backend (deployment)

The widgets call `${proxyPath}/…` same-origin (default `/__nextgen`). In
production the same-origin path must come from your hosting platform — until
the CLI can scaffold those configs, **production SPA deployment is not yet
supported**; see
[ADR 036](https://github.com/zitadel/nextgen/blob/main/docs/adrs/036-api-credential-planes.md)
and [zitadel/nextgen#560](https://github.com/zitadel/nextgen/issues/560). The
CLI dev proxy covers local development.

For local development you can also skip the proxy and point `proxyPath`
straight at the backend (cross-origin), e.g. `proxyPath: "http://localhost:8080"`
(the `zitadel start` local runtime default port).
