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
(`npx @zitadel/cli@alpha setup --framework angular`) with this SDK already wired in, and it can
patch some existing frameworks (e.g. Next.js). It **cannot** integrate into an
**existing** Angular app — it only scaffolds Angular into an empty directory. So
for an app that already exists, do **not** rely on the CLI; follow this skill to
install the package and wire the components in manually.

## Install

```sh
npm install @zitadel/sdk-angular@alpha
```

Peer dependencies: `@angular/core` and `@angular/common`, both `>=17`. Requires TypeScript ≥ 5.0 (the published types use `export type *`).

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

## Widget props and events

`ZitadelLogin`, `ZitadelLogout` and `ZitadelSession` take the props below, spelled the same in every SPA SDK. An unset prop keeps the widget's own default.

| Prop | Type | Default | Widgets | Description |
| --- | --- | --- | --- | --- |
| `project` | `ZitadelProject` | unset | Login, Logout, Session | The handle from `configureZitadel(...)`. Wins over `projectId` and `proxyPath`. |
| `projectId` | `string` | unset | Login, Logout, Session | Project id, read when no `project` handle is passed. |
| `proxyPath` | `string` | `"/__nextgen"` | Login, Logout, Session | Same-origin path the widget calls. |
| `purpose` | `CreateFlowBodyPurpose` | `"login"` | Login | Flow purpose. |
| `flowName` | `string` | unset | Login | Runs the flow definition with this `name`; unset runs the project's default flow for the purpose. |
| `postSignInUrl` | `string` | unset | Login | Where to navigate after a completed sign-in. When the page's `next` query parameter names a path on the same origin, as the server SDKs' middleware sets it for a signed-out visit to a protected route, the widget returns there instead. |
| `forcePostSignInUrl` | `boolean` | `false` | Login | Navigates to `postSignInUrl` even when the page's `next` query parameter names a path, for a page that uses `next` for something of its own. |
| `postSignOutUrl` | `string` | unset | Logout, Session | Where to navigate after sign-out. |
| `resumeFlowId` | `string` or `null` | unset | Login | An existing flow's id to resume instead of starting a new flow; unset, `null` or `""` falls back to the `flow` query parameter, and an id that no longer resolves starts a new flow. |
| `variant` | `"widget"` or `"page"` | `"widget"` | Login, Session | `widget` is content-sized and paints no page chrome; `page` claims the viewport, paints the surface background and loads the brand font, and on Login focuses the first field. |
| `theme` | `"light"`, `"dark"` or `"auto"` | unset | Login, Logout, Session | Colour mode. Unset follows the tenant's branding theme on Login, then the variant default (`dark` for `page`, `auto` for `widget`); Logout defaults to `auto`. `auto` follows `prefers-color-scheme`. |
| `suppressHeader` | `boolean` | `false` | Login, Session | Visually hides the widget's own heading block while keeping it in the accessibility tree, for pages that already carry the heading. |
| `suppressPasswordToggle` | `boolean` | `false` | Login | Hides the show/hide button on password fields. |
| `heading` | `string` | `"Signed in as"` | Session | Heading text override. |
| `logoutLabel` | `string` | `"Sign out"` | Session | Logout action label override. |
| `locales` | `Record<string, Partial<Record<string, string>>>` | unset | Login | Copy overrides merged over the builtin dictionaries, keyed by primary language subtag, for example `{ en: { "identifier.title": "Welcome back" } }`. |
| `lang` | `string` | browser language | Login | BCP-47 language override. |

Each widget event reaches the callback in the last column, which receives the event's `detail` payload.

| Widget event | Fires when | Detail | Widgets | Callback |
| --- | --- | --- | --- | --- |
| `zitadel-flow-step` | Login shows a step, the first one included. | `{ step }` | Login | `(flowStep)` |
| `zitadel-flow-input` | The visitor edits a field. | `{ name, secret: false, value }`, or `{ name, secret: true }` for a secret field | Login | `(flowInput)` |
| `zitadel-flow-complete` | The flow reaches a terminal step. | `{ behavior, redirect_uri?, handoff_token?, handoff_token_expires_at? }` | Login | `(flowComplete)` |
| `zitadel-flow-redirect` | The widget hands the browser to an identity provider; nobody is signed in yet. | `{ redirect_url, step }` | Login | `(flowRedirect)` |
| `zitadel-flow-error` | The flow reports an error. | `{ message }` | Login | `(flowError)` |
| `zitadel-signout` | The user signs out. | `{ display, identifier }` | Logout, Session | `(signout)` |

```html
<zitadel-auth-login [project]="project" theme="light" (flowComplete)="track($event)" />
```

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

- **Server rendering.** If your app renders on the server, mount the widget on the client only, after hydration (the `zitadel-auth-login` wrapper sets `projectId` and `proxyPath` as element properties, so adding them to the wrapper does not put them in server markup), or use a raw `<zitadel-login>` element with `project-id` and `proxy-path` as attributes, because a widget that starts before its configuration arrives shows an error instead of the flow.
- **Selector is `zitadel-auth-login`, not `zitadel-login`.** The wrapper's
  selector is `zitadel-auth-login` (and `zitadel-auth-logout`,
  `zitadel-auth-session`); `<zitadel-login>` is the underlying custom element
  the wrapper renders internally — don't use it directly.
- **Production SPA deployment is not yet supported.** The same-origin
  `${proxyPath}` must be provided by your hosting platform, and the CLI cannot
  yet scaffold those configs. The CLI dev proxy covers local development only.
- **Session card export name.** `<zitadel-auth-session>` is exported as
  `ZitadelSessionComponent`.
