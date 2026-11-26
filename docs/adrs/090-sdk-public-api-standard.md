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
   entry (kind `server`), a `./client` entry (kind `client`) and a
   `./components` entry (kind `widgets`) that re-exports the widgets of the
   matching UI SDK (see "Widgets come through the framework SDK"). The widget
   entry has the same name, `./components`, in all six: an SDK never names it
   after its renderer (`./react`). Any other entry has kind `other` and states
   every name it exports. The handler sits on `./server` in five of them;
   `sdk-next` declares `zitadelMiddleware` and `createProxy` on a separate
   `./middleware` entry (kind `other`) and keeps its auth reader on `./server`.

## The names

| Kind | Required exports |
| --- | --- |
| `ui` | `ZitadelLogin`, `ZitadelLogout`, `ZitadelSession`, `ZitadelLoginProps`, `ZitadelLogoutProps`, `ZitadelSessionProps`, `ZitadelFlowStepDetail`, `ZitadelFlowInputDetail`, `ZitadelFlowCompleteDetail`, `ZitadelFlowRedirectDetail`, `ZitadelFlowErrorDetail`, `ZitadelSignoutDetail`, `ZitadelFlowPurpose`, `ZitadelFlowStep`, `ZitadelFlowBehavior`, `configureZitadel`, `getApi`, `getZitadelConfig`, `businessLocales`, `ZitadelProject`, `ZitadelConfig` |
| `widgets` | the components, the three props types, the six detail types and the three flow types of `ui` |
| `client` | `configureZitadel`, `getApi`, `getZitadelConfig`, `ZitadelProject`, `ZitadelConfig`, plus `businessLocales` when the SDK renders widgets |
| `server` | the auth reader the entry declares, `ZitadelMiddlewareOptions`, `ZitadelAuthSession`, `ZitadelAuthResult`, `ZitadelAuthState`, `ZitadelUnauthState`, `ZitadelClientAuthResult`, plus the handler when the entry declares one |
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

In five SDKs the handler is exported from `./server`. `sdk-next` exports
`zitadelMiddleware` and `createProxy` from `./middleware`, as its
`public-api.json` declares.

A new SDK picks the name its framework uses, decides whether it is a factory
by what it returns, and writes the reason in the three places above.

## Widgets come through the framework SDK

Every meta-framework SDK exports the widgets and their types, so an app
imports everything Zitadel adds to its framework from one package. The widgets
themselves live in a UI SDK, and the framework SDK re-exports them **by name**
from a `./components` entry:

| Framework SDK | Re-exports the widgets of |
| --- | --- |
| `sdk-next`, `sdk-tanstack-start` | `sdk-react` |
| `sdk-sveltekit` | `sdk-svelte` |
| `sdk-qwik-router` | `sdk-qwik` |
| `sdk-solid-start` | `sdk-solid` |
| `sdk-nuxt` | `sdk-vue` |

`sdk-tanstack-start` is the one SDK whose `./components` entry does not re-export
the three components as they are: TanStack Start renders on the server and then
hydrates, so it wraps `ZitadelLogin`, `ZitadelLogout` and `ZitadelSession` in a
client-only wrapper, and re-exports only the types and `businessLocales` by name.
Its `configureZitadel` is in `./client`.

The reasons, so that nobody removes the re-export as redundant:

- **One import path for an app.** An app that imports from the framework SDK
  does not change when a widget moves between packages; only the re-export
  line changes.
- **One rule, not two.** `sdk-next` and `sdk-tanstack-start` already worked
  this way, and the other four did not, which made the same name appear in
  one SDK's reference and be missing from its sibling's. The standard now
  says the same thing for all six.
- **The server entries stay light.** The widgets are in their own
  `./components` entry, never in `./server` or `./client`, because the server
  entries run on edge runtimes and must not pull the widget package and its
  custom-element registration into a server bundle.
- **Nothing breaks.** The names are added, and the UI SDKs keep every export
  they have, so an app that imports from the UI SDK keeps working. The CLI
  scaffolders for SvelteKit, SolidStart and Qwik Router import the widgets from
  the framework SDK's `./components` entry, as the Next.js and TanStack Start
  ones do, and still declare the UI SDK as a direct dependency of the app,
  because the Svelte and Solid Vite plugins and Qwik's optimizer find the
  libraries they compile in the app's own `package.json`.

Rules that follow:

- Re-export by name, never `export *`, as the rule below says. The contract
  spec lists the exact names (`widgets` kind) and fails when one is missing.
- The UI SDK is a runtime `dependency` of the framework SDK, not a peer, and
  the framework SDK's `build` and `dev` tasks depend on the UI SDK's build.
- A name added to or removed from a UI SDK's widget surface changes its
  framework SDKs' `./components` entries in the same change.
- `sdk-nuxt` also has a `./client` entry (the same configuration helpers every
  client entry has). Its `.` entry keeps registering the raw custom elements,
  so apps that use `<zitadel-login>` directly keep working.

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
- **Angular uses signal inputs and outputs, and needs Angular 19 or newer.**
  The components declare `input()` and `output()`, which are stable from
  Angular 19, in place of `@Input()` and `@Output()`. Templates do not change
  (`[project]="project"`, `(flowComplete)="track($event)"`). The widgets' shared
  config fields are the inputs, one for one, and the shared event handlers are
  the outputs, so Angular's `ZitadelLoginProps`, `ZitadelLogoutProps` and
  `ZitadelSessionProps` are the inputs only: Angular has no `onFlowStep`
  callback prop to put in them. A spec in `sdk-angular` fails when a component's
  inputs and its Props type differ.
- **Angular uses the shared `configureZitadel`.** `sdk-angular` used to keep a
  local copy, because ng-packagr could not resolve the subpath-only exports of
  `@zitadel/api`. The package now builds with `vite` and `ngc` and imports
  `@zitadel/sdk-core/config` like every other SDK, so the constraint is gone and
  the function is the shared one: it registers the project once, and a later
  call with different values logs a warning and returns the first handle.
- **Nothing is re-exported by barrel.** An SDK names what it exports
  (`export type { … }`), never `export type *` or `export *` from another
  package. The helpers of `@zitadel/sdk-core/types` (`widgetTags`,
  `standardAttributes`, the `ZITADEL_*` constants, the `*EventMap` types) are
  `@internal` and never leave an SDK.
- **The API package is reached only through `sdk-core`.** The API package is
  generated from the OpenAPI document and changes with it, so only `sdk-core`
  sources import it. `sdk-core/src/config.ts` is the one seam: it declares `ZitadelProject`
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
- **Renaming a string is not renaming an export.** A renamed export breaks the
  build, but a renamed config key, environment variable, runtime-config key,
  header, cookie, state key or file name is ignored by whoever still uses the old
  one. An SDK that takes settings from such a name refuses the old one at setup:
  `sdk-nuxt` throws in `refuseLegacyConfig`, from the module at build time and from
  the server handler at start, because an ignored
  `protectedRoutes` leaves pages open. The other SDKs take their settings in code,
  so an old name fails at build time there. Every renamed string is listed under
  Renames and in the changeset's `**Breaking:**` paragraph.
- **The generated API reference is not part of a package.** `files` is an
  allowlist, so everything TypeDoc writes inside `dist` would ship. Each SDK
  lists `!dist/api-docs`, and the contract spec checks that it does.
- **A shared property is tested once for every SDK.** The shared contract
  packages hold the case (`describeSharedConfigHelpers`, `describeClientEntry`),
  and each SDK calls it with the same lines, so a forked function with the shared
  name and types cannot pass.
- **Session reading is not standard.** `useSession`, `getSession`,
  `sessionStore` and their types are extras of `sdk-react` and `sdk-next` until
  a second framework needs them.

## Naming of types

These rules apply to every exported type, interface and class of every SDK,
`sdk-core` included. Values are not renamed by them.

1. **Prefix every exported type with `Zitadel`.** An app imports from several
   SDKs and from auth libraries, and `AuthOptions`, `JwtPayload`,
   `ProxyHandler` and `AuthState` collide with them.
2. **Shape: `Zitadel<Noun>[<Qualifier>]<Suffix>`.** A widget name goes right
   after the prefix (`ZitadelLoginProps`), never after the suffix and never
   with a framework word.
3. **The suffix vocabulary is closed:** `Props`, `Config`, `Options`, `Detail`,
   `EventMap`, `Handlers`, `Result`, `State`, `Status`, `Error` and
   `ErrorCode`, `Snapshot`. Anything else needs a reason in the TSDoc.
4. **`Options` is named after the function, `Result` after the function that
   returns it** (`getSession`, `ZitadelGetSessionOptions`). Never `Input`,
   `Params`, `Args` or `Decision`.
5. **`Error` ends a name only for a failure:** a class extending `Error` with a
   stable `code`, or a plain `{ code, message }` reported as data. A code union
   is `<Name>ErrorCode`.
6. **Use `interface` for named object shapes, and `type` for unions,
   intersections, mapped and utility types, function types and tuples.**
7. **Every property of a type that an SDK hands to app code is `readonly`, and
   every array it accepts as input is `readonly T[]`.** An input type may widen
   later, and an output type may only gain fields.
8. **Properties are camelCase.** snake_case is allowed only on a field copied
   verbatim from the wire, and the TSDoc says so.
9. **Names are singular for one thing.** Plural is for a bag of callbacks
   (`Handlers`) or a bag of options that is a list.
10. **A type that stands in for a framework type keeps the framework word after
    the prefix** (`ZitadelQwikRequestEvent`). A type that a `createZitadel<X>`
    factory returns is `Zitadel<X>` where that is free.
11. **One stem has one meaning under one prefix.** `ZitadelSession` is the
    widget, `ZitadelAuthSession` is the server session with its token,
    `ZitadelClientSession` is the browser-safe one, and `ZitadelSessionStore*`
    is the browser store.
12. **List a rename** in Renames, in `public-api.json`, in the TSDoc, in the
    README and `SKILL.md` of every package that names it, and in the changeset's
    `**Breaking:**` paragraph.

## Renames

| Was | Is |
| --- | --- |
| `ZitadelLoginSolidProps`, `…ReactProps`, `…SvelteProps` (and Logout, Session) | `ZitadelLoginProps` (and Logout, Session) |
| `ZitadelLoginConfig`, `ZitadelLogoutConfig`, `ZitadelSessionConfig`, the `*Handlers` types, `ZitadelNavigationDetail`, `ZitadelWidgetAttributes` and `WithZitadelWidgetAttributes` as exports of a UI SDK | not exported; the config, handler and navigation types are in `@zitadel/sdk-core/types` |
| `ZitadelWidgetName`, `ZitadelWidgetTag`, `ZitadelStandardAttributeName`, `ZitadelStandardAttributes`, `ZitadelStandardAttributeProps` and the `Zitadel*EventMap` interfaces as exports of an SDK | not exported |
| the session, event and widget-name types in the `./components` entry of `sdk-tanstack-start` | not exported |
| `ZitadelLoginComponent`, `ZitadelLogoutComponent`, `ZitadelSessionComponent` (`sdk-angular`) | `ZitadelLogin`, `ZitadelLogout`, `ZitadelSession` |
| `CreateFlowBodyPurpose` (the type the API client is generated with) | `ZitadelFlowPurpose`, declared in `sdk-core` |
| `CreateFlow201Step` and `CreateFlow201StepComplete` as the types of an event's `step` and `behavior` | `ZitadelFlowStep` and `ZitadelFlowBehavior`, declared in `sdk-core` |
| `configureZitadel`, `getApi`, `getZitadelConfig`, `ZitadelProject`, `ZitadelConfig` from `@zitadel/api/config` | the same names from `@zitadel/sdk-core/config` |
| the `@zitadel/sdk-tanstack-start/react` widget entry | `@zitadel/sdk-tanstack-start/components`, the name every meta-framework SDK uses |
| `createNextgenHandle`, `createNextgenOnRequest`, `createNextgenRequestMiddleware`, `createNextgenMiddleware`, `nextgenMiddleware`, `handleNextgenRequest` | `createZitadelHandle`, `createZitadelOnRequest`, `createZitadelRequestMiddleware`, `createZitadelMiddleware`, `zitadelMiddleware`, `handleZitadelRequest` |
| `NextgenSession` | `ZitadelAuthSession` (`ZitadelSession` is the widget) |
| every exported type without the `Zitadel` prefix, for example `AuthState`, `AuthResult`, `ClientSession`, `SessionStore`, `JwtPayload`, `ProxyHandler`, `AuthOptions` | the same name with the `Zitadel` prefix |
| `ZitadelRequestDecision` | `ZitadelRequestResult` (rule 4) |
| `ZitadelRuntimeInput` | `ZitadelRuntimeOptions` (rule 4) |
| `QwikRequestEvent`, `QwikCookieValue`, `QwikCookieOptions`, `SolidFetchEvent`, `SolidMiddlewareConfig` | `ZitadelQwikRequestEvent`, `ZitadelQwikCookieValue`, `ZitadelQwikCookieOptions`, `ZitadelSolidFetchEvent`, `ZitadelSolidMiddlewareConfig` (rule 10) |
| `RequestMiddlewareContext` (`sdk-tanstack-start`) | `ZitadelRequestMiddlewareContext` |
| `UseSessionResult`, `GetSessionOptions` | `ZitadelUseSessionResult`, `ZitadelGetSessionOptions` (rule 4) |
| `SessionError`, `SessionErrorCode`, `SessionStatus`, `SessionSnapshot`, `SessionStore`, `SessionStoreOptions` | the same names with the `Zitadel` prefix; they name the browser store (rule 11) |
| `ZitadelLoginProps`, `ZitadelLogoutProps`, `ZitadelSessionProps` of `sdk-angular`, which were the callback props of `sdk-core` | the inputs of each component only |
| `@Input()` and `@Output()` in `sdk-angular`, peers `@angular/core` and `@angular/common` `>=17` | `input()` and `output()`, peers `>=19` |
| the local `configureZitadel` of `sdk-angular` | the shared one from `@zitadel/sdk-core/config` |
| `NextgenMiddlewareOptions`, `NextgenProvider`, `NextgenHandle`, `NextgenRequestOptions`, `NextgenRequestDecision` | `ZitadelMiddlewareOptions`, `ZitadelProvider`, `ZitadelHandle`, `ZitadelRequestOptions`, `ZitadelRequestResult` |
| the `x-nextgen-auth-token` header, `nextgenAuth` on the request context, the Nuxt `nextgen` configuration key and `NUXT_NEXTGEN_*` variables, the `plugin@nextgen.ts` Qwik route | `x-zitadel-auth-token`, `zitadelAuth`, `zitadel`, `NUXT_ZITADEL_*`, `plugin@zitadel.ts` |
| the legacy `__nextgen_session` cookie handling in `sdk-core` | removed; the server already refuses that name |
| `runtimeConfig.public.nextgenProxyPath` and `nextgenApiBase` (Nuxt), and the `NUXT_PUBLIC_NEXTGEN_*` variables that set them | `zitadelProxyPath` and `zitadelApiBase`, and `NUXT_PUBLIC_ZITADEL_*`; the module and the server handler refuse the old ones |
| `useState("nextgen-auth")` (Nuxt) and the `nextgenAuth` key of `event.locals`, `event.context` and Qwik's shared map | `"zitadel-auth"` and `zitadelAuth` |

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
