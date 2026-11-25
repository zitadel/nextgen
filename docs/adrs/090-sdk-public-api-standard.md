# ADR 090: One Public API Standard for Every SDK

> **Status:** Accepted
> **Date:** 2026-11-25
> **Context:** [ADR 036](036-api-credential-planes.md) (the same-origin proxy
> every SDK fronts); `packages/AGENTS.md` (the SDK rules)

## Decision

Every `@zitadel/sdk-*` package exports the same names for the same things,
from the same kinds of entry point, and where a name differs between SDKs the
difference has a stated reason. The standard below is the single statement of
it. The "SDK public API" block of `packages/sdk-core/src/contract.spec.ts`
fails when an SDK exports a name the standard does not allow or drops one it
requires, so an API change shows up as a diff in the pull request that makes
it and nowhere else.

There are two families.

1. **UI SDKs** (`sdk-solid`, `sdk-react`, `sdk-vue`, `sdk-svelte`, `sdk-qwik`,
   `sdk-angular`) have one entry, `.`, of kind `ui`.
2. **Meta-framework SDKs** (`sdk-next`, `sdk-tanstack-start`, `sdk-nuxt`,
   `sdk-sveltekit`, `sdk-qwik-router`, `sdk-solid-start`) have a `./server`
   entry (kind `server`) and a `./client` entry (kind `client`). Where the
   framework renders the widgets itself (`sdk-next`, `sdk-tanstack-start`),
   one more entry has kind `widgets`. Any other entry has kind `other` and
   states every name it exports.

## The names

| Kind | Required exports |
| --- | --- |
| `ui` | `ZitadelLogin`, `ZitadelLogout`, `ZitadelSession`, `ZitadelLoginProps`, `ZitadelLogoutProps`, `ZitadelSessionProps`, `ZitadelFlowStepDetail`, `ZitadelFlowInputDetail`, `ZitadelFlowCompleteDetail`, `ZitadelFlowRedirectDetail`, `ZitadelFlowErrorDetail`, `ZitadelSignoutDetail`, `ZitadelFlowPurpose`, `ZitadelFlowStep`, `ZitadelFlowBehavior`, `configureZitadel`, `getApi`, `getZitadelConfig`, `businessLocales`, `ZitadelProject`, `ZitadelConfig` |
| `widgets` | the components, the three props types, the six detail types and the three flow types of `ui` |
| `client` | `configureZitadel`, `getApi`, `getZitadelConfig`, `ZitadelProject`, `ZitadelConfig`, plus `businessLocales` when the SDK renders widgets |
| `server` | the auth reader the entry declares, `ZitadelMiddlewareOptions`, `ZitadelAuthSession`, `AuthResult`, `AuthState`, `UnauthState`, `ClientAuthResult`, plus the handler when the entry declares one |
| `other` | nothing is required |

An SDK declares its entries in `packages/<sdk>/public-api.json`: each entry's
`source` file, its `kind`, whether it renders `widgets`, a `handler` and an `authReader`
where the entry has them (each a `name` and the `why` behind it), and `extras`,
the names it exports beyond the required ones because its framework needs them.
The contract spec requires every `exports` key of the package to be declared
and every export to be required or listed as an extra.

## The server entry is named after its framework

The meta-framework SDKs do not share one handler name, on purpose. Each one
exposes the entry its framework asks for, under the framework's own term, so
the call in a customer's project reads like the framework's documentation. A
name that starts with `create` is a factory: it is called once and returns the
framework's handler. A name without it handles the request itself. The reason
for each name sits in three places that must agree: the `why` in
`public-api.json`, the TSDoc of the function, and this table.

| SDK | Handler | Why it is called that |
| --- | --- | --- |
| `sdk-sveltekit` | `createZitadelHandle` | SvelteKit calls this hook `handle`: it is the `handle` export of `hooks.server.ts`, composed with `sequence()`. A factory, so `create`. |
| `sdk-qwik-router` | `createZitadelOnRequest` | A Qwik Router route file exports its server hook as `onRequest`. A factory, so `create`. |
| `sdk-tanstack-start` | `createZitadelRequestMiddleware` | TanStack Start has request middleware and function middleware; the name says which one. A factory, so `create`. |
| `sdk-solid-start` | `createZitadelMiddleware` | SolidStart registers middleware through `createMiddleware`; this factory returns the configuration object it takes. |
| `sdk-nuxt` | `createZitadelMiddleware` | Nuxt calls these server middleware; this factory returns the h3 event handler such a file exports. |
| `sdk-next` | `zitadelMiddleware` | Next.js runs the function that `middleware.ts` (`proxy.ts` from Next.js 16) exports, with each request. `zitadelMiddleware(request, options)` is that function and handles the request itself, so it is not a factory and has no `create`. `createProxy` is the factory. |

The auth reader is `getAuth(event)` in every SDK that is handed the
framework's event or context, which is synchronous. `sdk-next` is the
exception: `auth()` reads the request from Next.js's async context, takes no
request and is `async`, so it keeps the name it has always had.

A new SDK picks the name its framework uses, decides whether it is a factory
by what it returns, and writes the reason in the three places above.

## Rules

- **One props type per widget.** `ZitadelLoginProps` is the full type the
  component accepts in that SDK: the widget's own props, its callbacks, the
  standard HTML attributes and `ref`. The framework-suffixed names
  (`ZitadelLoginSolidProps`, `ZitadelLoginReactProps`, `ZitadelLoginSvelteProps`)
  and the `Zitadel*Config`, `Zitadel*Handlers` and `ZitadelWidgetAttributes`
  layers are not exported.
- **Angular's components have no `Component` suffix.** Angular's own style
  guide stopped asking for it in v20 and the CLI no longer generates it, so
  the classes are `ZitadelLogin`, `ZitadelLogout` and `ZitadelSession`, as in
  every other SDK. Their template selectors are `zitadel-auth-login`,
  `zitadel-auth-logout` and `zitadel-auth-session`, because `zitadel-login` and
  its siblings are the widgets' own element names.
- **Nothing is re-exported by barrel.** An SDK names what it exports
  (`export type { … }`), never `export type *` or `export *` from another
  package. The helpers of `@zitadel/sdk-core/types` (`widgetTags`,
  `standardAttributes`, the `ZITADEL_*` constants, the `*EventMap` types) are
  `@internal` and never leave an SDK.
- **The API package is reached only through `sdk-core`.** The API package is
  generated from the OpenAPI document and changes with it, so no SDK imports
  it. `sdk-core/src/config.ts` is the one seam: it declares `ZitadelProject`
  and `ZitadelConfig` itself and wraps `configureZitadel`, `getZitadelConfig`
  and `getApi`, and every SDK imports them from `@zitadel/sdk-core/config`.
- **No generated name or shape is public.** What an app can see is declared by
  hand in `sdk-core` and checked against the API in `types.spec.ts` and
  `config.spec.ts`. `ZitadelFlowPurpose` and `ZitadelFlowBehavior` must equal
  the API's unions, `ZitadelFlowStep` must be something every generated step
  can be read as, and the configuration types must be assignable both ways. An
  API change then breaks one check in `sdk-core`, where it is decided what the
  SDKs do, instead of changing the SDKs' public types unnoticed. `getApi` still
  returns the generated client; that type is the one generated name an SDK
  exposes, and it is documented as changing with the API. A first-party app
  that needs more of a step than `ZitadelFlowStep` promises, such as the
  console, names the generated type itself.
- **No SDK public name, header, configuration key or text uses the codename
  "nextgen".** It was the name of the alpha. Use Zitadel. The one exception is
  the `/__nextgen` proxy path, which the server also knows and which stays the
  default until the server and the SDKs change it together.
- **Session reading is not standard.** `useSession`, `getSession`,
  `sessionStore` and their types are extras of `sdk-react` and `sdk-next` until
  a second framework needs them.

## Renames

| Was | Is |
| --- | --- |
| `ZitadelLoginSolidProps`, `…ReactProps`, `…SvelteProps` (and Logout, Session) | `ZitadelLoginProps` (and Logout, Session) |
| `ZitadelLoginComponent`, `ZitadelLogoutComponent`, `ZitadelSessionComponent` (`sdk-angular`) | `ZitadelLogin`, `ZitadelLogout`, `ZitadelSession` |
| `CreateFlowBodyPurpose` (the type the API client is generated with) | `ZitadelFlowPurpose`, declared in `sdk-core` |
| `CreateFlow201Step` and `CreateFlow201StepComplete` as the types of an event's `step` and `behavior` | `ZitadelFlowStep` and `ZitadelFlowBehavior`, declared in `sdk-core` |
| `configureZitadel`, `getApi`, `getZitadelConfig`, `ZitadelProject`, `ZitadelConfig` from `@zitadel/api/config` | the same names from `@zitadel/sdk-core/config` |
| `createNextgenHandle`, `createNextgenOnRequest`, `createNextgenRequestMiddleware`, `createNextgenMiddleware`, `nextgenMiddleware`, `handleNextgenRequest` | `createZitadelHandle`, `createZitadelOnRequest`, `createZitadelRequestMiddleware`, `createZitadelMiddleware`, `zitadelMiddleware`, `handleZitadelRequest` |
| `NextgenSession` | `ZitadelAuthSession` (`ZitadelSession` is the widget) |
| `NextgenMiddlewareOptions`, `NextgenProvider`, `NextgenHandle`, `NextgenRequestOptions`, `NextgenRequestDecision` | `ZitadelMiddlewareOptions`, `ZitadelProvider`, `ZitadelHandle`, `ZitadelRequestOptions`, `ZitadelRequestDecision` |
| the `x-nextgen-auth-token` header, `nextgenAuth` on the request context, the Nuxt `nextgen` configuration key and `NUXT_NEXTGEN_*` variables, the `plugin@nextgen.ts` Qwik route | `x-zitadel-auth-token`, `zitadelAuth`, `zitadel`, `NUXT_ZITADEL_*`, `plugin@zitadel.ts` |
| the legacy `__nextgen_session` cookie handling in `sdk-core` | removed; the server already refuses that name |

`sdk-angular` gains `getApi` and `getZitadelConfig`, and `sdk-next` gains
`getZitadelConfig`.

## Consequences

The renames break every app that imports the old names. The SDKs are not
public yet, and the CLI's scaffolders, the demos, the conformance fixtures and
the docs change in the same release, so no generated app uses an old name. An
app scaffolded earlier keeps `plugin@nextgen.ts` and the old imports until its
owner rescaffolds it.

What this ADR does not change, and a later one has to decide together with the
server: the `/__nextgen` proxy path, the server's `NEXTGEN_*` environment
variables, binary, image and data-directory names, the database schema, the Go
module path and the title of the OpenAPI document.
