# @zitadel/sdk-angular

Angular components for the Zitadel auth UI, for client-side SPAs.

## Installation

```bash
pnpm add @zitadel/sdk-angular@latest
```

## Requirements

Peer dependencies: `@angular/core` and `@angular/common`, both `>=17`.

Edge support follows Angular's own: its server rendering targets Node, and the application builder produces a bundle without Node APIs only through the experimental `ssr.platform: "neutral"` option. In an Angular 22.2.3 app built with that option and `conditions: ["workerd", "browser"]`, the three wrappers bundle, load and server-render inside the `edge-runtime` VM, each as its custom element tag with its attributes. The package's tests cover the built package in that VM with the Angular linker applied, as a consumer's build applies it: they load it without a DOM, render each widget by its tag name, and check the attributes written into the login markup and that `lang` is left out when unset. Without those `conditions` the build stops while extracting routes with `document is not defined`, because the components root then loads Lit. The builder applies `conditions` to the browser bundle too, and the edge build of `@zitadel/components` registers no elements, so that bundle does not register the widgets; the browser side of an edge deployment has not been verified.

TypeScript ≥ 5.0, the floor shared by every SDK; see the [compatibility notes](https://github.com/zitadel/nextgen/blob/main/packages/AGENTS.md).

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

`<zitadel-auth-login>` also takes `resumeFlowId`, an existing flow to resume instead of starting a new one; unset, `null` or `""` falls back to the `flow` query parameter.

The signed-in session card is `<zitadel-auth-session>` (exported as `ZitadelSessionComponent`).

> The wrapper uses the selector `zitadel-auth-login` (not `zitadel-login`) because
> the latter is the underlying custom element the component renders internally.

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
| `zitadel-flow-input` | The visitor edits a field. | `{ name, value }` | Login | `(flowInput)` |
| `zitadel-flow-complete` | The flow reaches a terminal step. | `{ behavior, redirect_uri?, handoff_token?, handoff_token_expires_at? }` | Login | `(flowComplete)` |
| `zitadel-flow-redirect` | The widget hands the browser to an identity provider; nobody is signed in yet. | `{ redirect_url, step }` | Login | `(flowRedirect)` |
| `zitadel-flow-error` | The flow reports an error. | `{ message }` | Login | `(flowError)` |
| `zitadel-signout` | The user signs out. | `{ display, identifier }` | Logout, Session | `(signout)` |

```html
<zitadel-auth-login [project]="project" theme="light" (flowComplete)="track($event)" />
```

The `zitadel-flow-complete`, `zitadel-flow-redirect` and `zitadel-signout` details carry a `waitUntil(promise)`; call it from your handler to make the widget wait for your async work before it navigates.

## Standard HTML attributes

The Angular components are tags (`zitadel-auth-login`, `zitadel-auth-logout` and `zitadel-auth-session`), and a tag already carries the standard HTML attributes: put `class`, `style`, `id`, `data-*` or `aria-*` on it and Angular applies them to the tag, not to the widget inside it.

```html
<zitadel-auth-login [project]="project" class="login" data-testid="login" aria-label="Sign in" />
```

## Server rendering

If your app renders on the server, mount the widget on the client only, after hydration (the `zitadel-auth-login` wrapper sets `projectId` and `proxyPath` as element properties, so adding them to the wrapper does not put them in server markup), or use a raw `<zitadel-login>` element with `project-id` and `proxy-path` as attributes, because a widget that starts before its configuration arrives shows an error instead of the flow.

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
