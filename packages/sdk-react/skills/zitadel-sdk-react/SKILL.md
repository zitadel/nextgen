---
name: zitadel-sdk-react
description: >-
  Integrate Zitadel authentication into an existing React app with
  `@zitadel/sdk-react`. Use when adding Zitadel login, registration, logout, or
  session handling to a client-side React / Vite SPA or a TanStack
  (Router/Start) app — wiring the `ZitadelLogin`, `ZitadelLogout`, and
  `ZitadelSession` auth-UI components into pages you already have.
---

# @zitadel/sdk-react

React wrappers around the Zitadel auth-UI web components, for client-side SPAs.

## When to use

Use this skill to drop the Zitadel auth UI into an **existing or custom** React
app — your own routes, your own bundler (Vite, TanStack Start, etc.) — by
rendering the SDK's components on your login/profile pages.

If the user instead wants a **fresh** app scaffolded, the CLI does that:
`npx @zitadel/cli@alpha setup --framework react` generates a wired React project. Reach for
this skill when there is already an app to integrate into and the CLI's
scaffolding would overwrite or not fit it.

## Install

```sh
npm install @zitadel/sdk-react@alpha
```

Peer dependencies: `react >=18` and `react-dom >=18`. Requires TypeScript ≥ 5.0 (the published types use `export type *`).

## Integrate

Call `configureZitadel(...)` once before rendering and pass the returned handle
as the `project` prop. The SPA renders after configuration, so the handle is
present when the underlying web component upgrades.

```tsx
import {
  ZitadelLogin,
  ZitadelLogout,
  ZitadelSession,
  configureZitadel,
} from "@zitadel/sdk-react";

// Configure once, module scope, before rendering.
const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID, // or your env source
  proxyPath: "/__nextgen", // same-origin path your deploy proxies to the backend
});

export function LoginPage() {
  return <ZitadelLogin project={project} purpose="login" postSignInUrl="/" />;
}

export function ProfilePage() {
  return (
    <>
      <ZitadelSession project={project} />
      <ZitadelLogout project={project} postSignOutUrl="/login" />
    </>
  );
}
```

- `purpose` defaults to `"login"`; set it for other flows.
- `postSignInUrl` / `postSignOutUrl` are where the widget sends the user after
  the flow completes.
- The widget's `zitadel-*` events reach you as the `on*` callbacks listed under
  Widget props and events.

## Widget props and events

`ZitadelLogin`, `ZitadelLogout` and `ZitadelSession` take the props below, spelled the same in every SPA SDK. An unset prop keeps the widget's own default.

| Prop | Type | Default | Widgets | Description |
| --- | --- | --- | --- | --- |
| `project` | `ZitadelProject` | unset | Login, Logout, Session | The handle from `configureZitadel(...)`. Wins over `projectId` and `proxyPath`. |
| `projectId` | `string` | unset | Login, Logout, Session | Project id, read when no `project` handle is passed. |
| `proxyPath` | `string` | `"/__nextgen"` | Login, Logout, Session | Same-origin path the widget calls. |
| `purpose` | `CreateFlowBodyPurpose` | `"login"` | Login | Flow purpose. |
| `flowName` | `string` | unset | Login | Runs the flow definition with this `name`; unset runs the project's default flow for the purpose. |
| `postSignInUrl` | `string` | unset | Login | Where to navigate after a completed sign-in. |
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
| `zitadel-flow-step` | Login shows a step, the first one included. | `{ step }` | Login | `onFlowStep` |
| `zitadel-flow-input` | The visitor edits a field. | `{ name, value }` | Login | `onFlowInput` |
| `zitadel-flow-complete` | The flow reaches a terminal step. | `{ behavior, redirect_uri?, handoff_token?, handoff_token_expires_at? }` | Login | `onFlowComplete` |
| `zitadel-flow-redirect` | The widget hands the browser to an identity provider; nobody is signed in yet. | `{ redirect_url, step }` | Login | `onFlowRedirect` |
| `zitadel-flow-error` | The flow reports an error. | `{ message }` | Login | `onFlowError` |
| `zitadel-signout` | The user signs out. | `{ display, identifier }` | Logout, Session | `onSignout` |

```tsx
<ZitadelLogin project={project} theme="light" onFlowComplete={(detail) => track(detail)} />
```

## Read these, don't guess

This skill is the integration **pattern**, not an API catalog — exact names,
props, and defaults are authoritative only at the source. Before relying on a
specific prop or export, read:

- `node_modules/@zitadel/sdk-react/README.md` — the installed package's own docs.
- The package's TypeScript types (`node_modules/@zitadel/sdk-react/dist/index.d.ts`
  and its re-exported `@zitadel/sdk-core/types`) — the authoritative list of
  exported components, props, and event-detail shapes.

Discover from those rather than assuming; the package and this skill version
independently and a hardcoded API list here would drift.

## Gotchas

- **Server rendering.** If your app renders on the server, mount the widget on the client only, after hydration, or pass `project-id` and `proxy-path` as strings, because a widget that starts before its configuration arrives shows an error instead of the flow. React 19 does not apply an object property such as `project` while hydrating a server-rendered custom element, so on a server-rendered page pass `project-id` and `proxy-path` as strings instead of a `project` handle.
- **TypeScript ≥ 5.0 required** — the published types use `export type *`, which
  older TypeScript cannot parse.
- **Client-side only.** These wrap browser web components; render them in the
  client, not during server rendering.
- **Same-origin proxy.** The widgets call `${proxyPath}/…` same-origin (default
  `/__nextgen`). Your deployment must proxy that path to the Zitadel backend.
  Production SPA deployment is not yet fully supported — see
  [ADR 036](https://github.com/zitadel/nextgen/blob/main/docs/adrs/036-api-credential-planes.md)
  and [zitadel/nextgen#560](https://github.com/zitadel/nextgen/issues/560). The
  CLI dev proxy covers local development.
- **Local dev without a proxy.** You can point `proxyPath` straight at the
  backend cross-origin, e.g. `proxyPath: "http://localhost:8080"` (the
  `zitadel start` default port).
- **Configure before render.** Build the handle with `configureZitadel(...)` at
  module scope and pass it as `project`, so it is set when the element upgrades.
