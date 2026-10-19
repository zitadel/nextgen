---
name: zitadel-sdk-qwik
description: >-
  Integrate Zitadel authentication into a Qwik app with `@zitadel/sdk-qwik`.
  Use when the user wants to add login, logout, or a signed-in session card to
  an existing or custom client-side Qwik SPA — wiring the `ZitadelLogin`,
  `ZitadelLogout`, or `ZitadelSession` components and `configureZitadel`.
---

# @zitadel/sdk-qwik

Qwik components that wrap the Zitadel auth UI web components (`<zitadel-login>`,
`<zitadel-logout>`, `<zitadel-session>`) for client-side SPAs (Vite, etc.). The
package exports the components, the `configureZitadel` handle factory, and the
shared SPA config/handler types.

## When to use

- **Fresh Qwik app → use the CLI instead.** `npx @zitadel/cli@alpha setup --framework qwik`
  scaffolds auth into a new or detected Qwik project end to end (it wires this
  SDK, the dev proxy, and config). Reach for the `zitadel-cli` skill for that.
  Note the CLI scaffolds against **Qwik 2**, which this package also targets.
- **This skill is for an existing or custom Qwik app** where you are adding the
  components by hand — or adjusting a wiring the CLI already produced.

## Install

```sh
pnpm add @zitadel/sdk-qwik@alpha
```

The package declares a peer dependency on `@qwik.dev/core` (`^2.0.0-beta.45`),
so the host app must be on **Qwik 2**. TypeScript ≥ 5.0 is required — the
published types re-export with `export type *`, a 5.0 feature.

## Integrate

Build a project handle with `configureZitadel`, then render a component with it:

```tsx
import { component$ } from '@qwik.dev/core';
import { ZitadelLogin, configureZitadel } from '@zitadel/sdk-qwik';

export default component$(() => {
  const project = configureZitadel({
    projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
    proxyPath: '/__nextgen',
  });

  return <ZitadelLogin project={project} purpose="login" postSignInUrl="/" />;
});
```

- `<ZitadelLogout project={project} postSignOutUrl="/login" />` works the same way.
- `<ZitadelSession project={project} />` renders the signed-in session card.
- Instead of the `project` handle you may pass the discrete `projectId` /
  `proxyPath` props; the widget uses whichever is present.
- Widget events are optional QRL callbacks; see Widget props and events.
- The SDK binds `project` (and `projectId` / `proxyPath`) to the element as DOM
  *properties*, matching the other framework SDKs.

## Widget props and events

`ZitadelLogin`, `ZitadelLogout` and `ZitadelSession` take the props below, spelled the same in every SPA SDK. An unset prop keeps the widget's own default.

They also take the standard HTML attributes (`class`, `style`, `id`, `data-*`, `aria-*`, …) and forward them to the widget element; the README says how.

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
| `zitadel-flow-step` | Login shows a step, the first one included. | `{ step }` | Login | `onFlowStep$` |
| `zitadel-flow-input` | The visitor edits a field. | `{ name, value }` | Login | `onFlowInput$` |
| `zitadel-flow-complete` | The flow reaches a terminal step. | `{ behavior, redirect_uri?, handoff_token?, handoff_token_expires_at? }` | Login | `onFlowComplete$` |
| `zitadel-flow-redirect` | The widget hands the browser to an identity provider; nobody is signed in yet. | `{ redirect_url, step }` | Login | `onFlowRedirect$` |
| `zitadel-flow-error` | The flow reports an error. | `{ message }` | Login | `onFlowError$` |
| `zitadel-signout` | The user signs out. | `{ display, identifier }` | Logout, Session | `onSignout$` |

```tsx
<ZitadelLogin project={project} theme="light" onFlowComplete$={(detail) => track(detail)} />
```

## Read these, don't guess

Confirm the current surface before wiring — do not rely on memory:

- `node_modules/@zitadel/sdk-qwik/README.md` — the installed package's own usage
  notes (proxying, deployment status) are authoritative over this skill.
- The package's `.d.ts` types (`node_modules/@zitadel/sdk-qwik/dist/index.d.ts`)
  are the source of truth for exports and prop names. The named exports are
  `ZitadelLogin`, `ZitadelLogout`, `ZitadelSession`, `configureZitadel`,
  `getApi`, `getZitadelConfig`, and `businessLocales`; prop types
  (`ZitadelLoginProps`, etc.) and the shared SPA config/handler types are
  re-exported there. Check props (`purpose`, `variant`, `theme`, `flowName`,
  `locales`, `lang`, `ref`, …) against the types rather than assuming them.

## Gotchas

- **Server rendering.** If your app renders on the server, pass `projectId` and `proxyPath` to the `ZitadelLogin` wrapper as strings (it writes them as the `project-id` and `proxy-path` attributes; use those hyphenated names only on a raw `<zitadel-login>` element), because a widget that starts before its configuration arrives shows an error instead of the flow. `ZitadelLogout` and `ZitadelSession` do the same, and the other string and boolean options (`purpose`, `flowName`, `postSignInUrl`, `forcePostSignInUrl`, `resumeFlowId`, `postSignOutUrl`, `variant`, `theme`, `heading`, `logoutLabel`, `lang`, `suppressHeader`, `suppressPasswordToggle`) are written as attributes too. A `project` handle contributes its `projectId`, `proxyPath`, `url` and `publishableKey` as attributes; the rest of the handle, and `locales`, are set as element properties after hydration, so a widget that needs `locales` still gets them only on the client.
- **Qwik 2 only.** The peer dep is `@qwik.dev/core ^2.0.0-beta.45` and imports
  come from `@qwik.dev/core` (not `@builder.io/qwik`). A Qwik 1 app will not
  satisfy the peer range.
- **Proxying is same-origin.** The widgets call `${proxyPath}/…` same-origin
  (default `/__nextgen`). The CLI dev proxy covers local development. Per the
  README, **production SPA deployment is not yet supported** — the same-origin
  path must come from your hosting platform, and the CLI cannot scaffold those
  configs yet.
- **Local dev without the proxy.** You can point `proxyPath` straight at the
  backend cross-origin, e.g. `proxyPath: 'http://localhost:8080'` (the
  `zitadel start` local runtime default port).
- **Properties and attributes.** Qwik 2 binds custom-element JSX props as
  lower-cased attributes only, so the wrapper writes string and boolean config
  as kebab-case attributes (present in server markup) and applies all config,
  including property-only values such as `locales`, as DOM properties on the
  client — which is why the SDK wrapper exists rather than using the web
  components directly.
