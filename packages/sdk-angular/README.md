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

### Configuration

`configureZitadel`, `getApi`, `getZitadelConfig` and the `ZitadelConfig` / `ZitadelProject`
types are re-exported from `@zitadel/api/config`, the same module every Zitadel SPA SDK uses.
`configureZitadel(...)` returns the project handle and also records it as the app-wide
config, so a component rendered without `[project]` falls back to it. It accepts an optional
`publishableKey`, which `getApi(project)` sends as the bearer on direct API calls.

### Inputs and outputs

Each component's inputs mirror the shared `ZitadelLoginConfig` / `ZitadelLogoutConfig` /
`ZitadelSessionConfig` types. An input you leave unset, or clear back to `undefined`, keeps
the widget's own default (e.g. `purpose` is `"login"`).

| Component                | Outputs (each emits the event detail)                                |
| ------------------------ | -------------------------------------------------------------------- |
| `<zitadel-auth-login>`   | `flowStep`, `flowInput`, `flowComplete`, `flowRedirect`, `flowError` |
| `<zitadel-auth-logout>`  | `signout`, `sessionMissing`, `sessionError`                          |
| `<zitadel-auth-session>` | `signout`, `sessionMissing`, `sessionError`                          |

`sessionMissing` fires when the visitor has no session: the widget renders nothing, and the
session card goes to its `postSignOutUrl` when one is set, unless that URL is the page it is on.
`sessionError` fires when loading the session (`phase: "load"`) or signing out
(`phase: "signout"`) fails some other way, such as a 5xx or a network error: the widget keeps
its surface and shows the error, and the detail carries `message` and, when a response came
back, its `status` and `code`.

```html
<zitadel-auth-login [project]="project" (flowComplete)="onComplete($event)"
  (flowError)="onError($event)" />
```

### Projected content

Content placed inside a component is projected into the underlying element (for example
`<zitadel-auth-login>`'s `attribution-trailing` slot). `<zitadel-auth-session>` projects
nothing: its element has no slot to show content in. A `<template>`
inside `<zitadel-auth-logout>` replaces the avatar menu with your own markup: `{{display}}`,
`{{identifier}}` and `{{initial}}` are filled in, and any element with `data-action="logout"`
signs the user out. Mark the `<template>` `ngNonBindable` so Angular leaves the
`{{…}}` placeholders for the element to fill:

```html
<zitadel-auth-logout [project]="project" postSignOutUrl="/login">
  <template ngNonBindable>
    <span>{{display}}</span>
    <button data-action="logout">Sign out</button>
  </template>
</zitadel-auth-logout>
```

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
