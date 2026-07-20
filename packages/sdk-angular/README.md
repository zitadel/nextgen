# @zitadel/sdk-angular

Angular components for the Zitadel auth UI, for client-side SPAs.

## Requirements

TypeScript ≥ 5.0 — the published type definitions re-export with `export type *`, which TypeScript introduced in 5.0.

## Usage

```ts
import { Component } from '@angular/core';
import { ZitadelLoginComponent, configureZitadel } from '@zitadel/sdk-angular';

const project = configureZitadel({ projectId: '…', proxyPath: '/__nextgen' });

@Component({
  standalone: true,
  imports: [ZitadelLoginComponent],
  template: `<zitadel-auth-login
    [project]="project"
    purpose="login"
    postSignInUrl="/"
  />`,
})
export class LoginPage {
  project = project;
}
```

`<zitadel-auth-logout [project]="project" postSignOutUrl="/login" />` works the same way.

> The wrapper uses the selector `zitadel-auth-login` (not `zitadel-login`) because
> the latter is the underlying custom element the component renders internally.

## Proxying to the backend (deployment)

The widgets call `${proxyPath}/…` same-origin (default `/__nextgen`). In production
that path comes from your hosting platform — a `vercel.json` rewrite, a
`netlify.toml` redirect, or a minimal Cloudflare worker — per
[ADR 036](https://github.com/zitadel/nextgen/blob/main/docs/adrs/036-api-credential-planes.md)
(scaffolding tracked in [zitadel/nextgen#560](https://github.com/zitadel/nextgen/issues/560);
**until that work lands, production SPA deployment is not yet supported**).
Locally you can point `proxyPath` straight at the backend (cross-origin), e.g.
`proxyPath: "http://localhost:4000"`.
