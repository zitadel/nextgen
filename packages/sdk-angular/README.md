# @zitadel/sdk-angular

Angular components for the Zitadel auth UI, for client-side SPAs.

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

The widgets call `${proxyPath}/…` same-origin (default `/__nextgen`). On Vercel use
`@zitadel/edge-proxy` to forward those calls (see the React/Vue READMEs for the
`vercel.json` rewrite + edge function). Locally you can point `proxyPath` straight at
the backend (cross-origin), e.g. `proxyPath: "http://localhost:4000"`.
