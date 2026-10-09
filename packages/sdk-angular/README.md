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

The signed-in session card is `<zitadel-auth-session>` (exported as `ZitadelSessionComponent`).

> The wrapper uses the selector `zitadel-auth-login` (not `zitadel-login`) because
> the latter is the underlying custom element the component renders internally.

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
