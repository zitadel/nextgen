---
name: zitadel-sdk-angular
description: >-
  Integrate Zitadel authentication into an Angular app with
  @zitadel/sdk-angular — the client-side SPA components for login,
  registration, logout, and the signed-in session card. Use when adding or
  wiring Zitadel auth, a login or registration screen, or session handling into
  an Angular app, and especially when the app already exists (the CLI cannot
  patch an existing Angular app, so wire it in by hand with this skill).
---

# @zitadel/sdk-angular

Angular wrapper components for the Zitadel auth UI in a client-side SPA.

## When to use

You are adding Zitadel login, registration, logout, or session handling to an
Angular app and wiring the auth UI in by hand.

The `zitadel` CLI can scaffold a *fresh* Angular app
(`zitadel setup --framework angular`) with this SDK already wired in, and it can
patch some existing frameworks (e.g. Next.js). It **cannot** integrate into an
**existing** Angular app — it only scaffolds Angular into an empty directory. So
for an app that already exists, do **not** rely on the CLI; follow this skill to
install the package and wire the components in manually.

## Install

```sh
npm install @zitadel/sdk-angular
```

Peer dependencies (already present in any Angular 17+ app): `@angular/core` and
`@angular/common`, both `>=17`. The published types require TypeScript `>= 5.0`.

## Integrate

The components are **standalone** — import them directly into a component's
`imports`. There is no NgModule, provider, or route guard to register.

1. Build a project handle once with `configureZitadel(...)` and pass it to the
   components via the `[project]` input:

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

2. Logout and the signed-in session card follow the same shape:

   ```html
   <zitadel-auth-logout [project]="project" postSignOutUrl="/login" />
   <zitadel-auth-session [project]="project" postSignOutUrl="/login" />
   ```

3. Wire them into your routes as ordinary standalone components, e.g. a
   `/login` route rendering `LoginPage` and a `/logout` route rendering a
   component that imports `ZitadelLogoutComponent`. `purpose="login"` vs
   `purpose="register"` on `<zitadel-auth-login>` selects sign-in vs
   registration; `postSignInUrl` / `postSignOutUrl` are where the widget sends
   the user afterwards.

4. The widgets call `${proxyPath}/…` **same-origin** (default `/__nextgen`). For
   local development you can instead point `proxyPath` straight at the backend
   (cross-origin), e.g. `proxyPath: 'http://localhost:8080'` (the `zitadel start`
   local runtime default port).

## Read these, don't guess

This skill shows the *pattern*; it is not an API catalog and will drift. For
exact names, inputs, and props, treat the installed package as authoritative:

- `node_modules/@zitadel/sdk-angular/README.md` — the install, usage, and
  proxy/deployment notes.
- The TypeScript types / exports (`node_modules/@zitadel/sdk-angular/dist/types/public-api.d.ts`)
  — the exported symbols (`ZitadelLoginComponent`, `ZitadelLogoutComponent`,
  `ZitadelSessionComponent`, `configureZitadel`, `ZitadelConfig`,
  `ZitadelProject`, `businessLocales`) and every component `@Input()` /
  `@Output()`. Read them before using an input you are unsure of.

## Gotchas

- **Selector is `zitadel-auth-login`, not `zitadel-login`.** The wrapper's
  selector is `zitadel-auth-login` (and `zitadel-auth-logout`,
  `zitadel-auth-session`); `<zitadel-login>` is the underlying custom element
  the wrapper renders internally — don't use it directly.
- **Production SPA deployment is not yet supported.** The same-origin
  `${proxyPath}` must be provided by your hosting platform, and the CLI cannot
  yet scaffold those configs. The CLI dev proxy covers local development only.
- **Session card export name.** `<zitadel-auth-session>` is exported as
  `ZitadelSessionComponent`.
