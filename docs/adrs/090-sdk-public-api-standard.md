# ADR 090: One Public API Standard for Every SDK

> **Status:** Accepted
> **Date:** 2026-11-25
> **Context:** [ADR 036](036-api-credential-planes.md) (the same-origin proxy
> every SDK fronts); `packages/AGENTS.md` (the SDK rules)

## Decision

Every `@zitadel/sdk-*` package exports the same names, from the same kinds of
entry point, whatever the framework. The standard below is the single
statement of it. `packages/sdk-core/src/contract.spec.ts` ("SDK public API ↔
the standard") fails when an SDK exports a name the standard does not allow
or drops one it requires, so an API change shows up as a diff in the pull
request that makes it and nowhere else.

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
| `ui` | `ZitadelLogin`, `ZitadelLogout`, `ZitadelSession` (Angular: the same with a `Component` suffix), `ZitadelLoginProps`, `ZitadelLogoutProps`, `ZitadelSessionProps`, `ZitadelFlowStepDetail`, `ZitadelFlowInputDetail`, `ZitadelFlowCompleteDetail`, `ZitadelFlowRedirectDetail`, `ZitadelFlowErrorDetail`, `ZitadelSignoutDetail`, `CreateFlowBodyPurpose`, `configureZitadel`, `getApi`, `getZitadelConfig`, `businessLocales`, `ZitadelProject`, `ZitadelConfig` |
| `widgets` | the components, the three props types, the six detail types and `CreateFlowBodyPurpose` of `ui` |
| `client` | `configureZitadel`, `getApi`, `getZitadelConfig`, `ZitadelProject`, `ZitadelConfig`, plus `businessLocales` when the SDK renders widgets |
| `server` | `createNextgenMiddleware`, `getAuth`, `NextgenMiddlewareOptions`, `NextgenSession`, `AuthResult`, `AuthState`, `UnauthState`, `ClientAuthResult` |
| `other` | nothing is required |

An SDK declares its entries in `packages/<sdk>/public-api.json`: each entry's
`source` file, its `kind`, whether it renders `widgets`, a `componentSuffix`
where the components are named differently, and `extras`, the names it
exports beyond the required ones because its framework needs them. The
contract spec requires every `exports` key of the package to be declared and
every export to be required or listed as an extra.

## Rules

- **One props type per widget.** `ZitadelLoginProps` is the full type the
  component accepts in that SDK: the widget's own props, its callbacks, the
  standard HTML attributes and `ref`. The framework-suffixed names
  (`ZitadelLoginSolidProps`, `ZitadelLoginReactProps`, `ZitadelLoginSvelteProps`)
  and the `Zitadel*Config`, `Zitadel*Handlers` and `ZitadelWidgetAttributes`
  layers are not exported.
- **Nothing is re-exported by barrel.** An SDK names what it exports
  (`export type { … }`), never `export type *` or `export *` from another
  package. The helpers of `@zitadel/sdk-core/types` (`widgetTags`,
  `standardAttributes`, the `ZITADEL_*` constants, the `*EventMap` types) are
  `@internal` and never leave an SDK.
- **One name for the server entry.** The middleware factory is
  `createNextgenMiddleware` and the auth reader is `getAuth` in every
  meta-framework SDK; what the factory returns is the framework's own.
- **Session reading is not standard.** `useSession`, `getSession`, `sessionStore`
  and their types are extras of `sdk-react` and `sdk-next` until a second
  framework needs them.

## Renames

| Was | Is |
| --- | --- |
| `nextgenMiddleware` (`sdk-next`) | `createNextgenMiddleware` |
| `auth` (`sdk-next`) | `getAuth` |
| `createNextgenRequestMiddleware` (`sdk-tanstack-start`) | `createNextgenMiddleware` |
| `createNextgenHandle` (`sdk-sveltekit`) | `createNextgenMiddleware` |
| `createNextgenOnRequest` (`sdk-qwik-router`) | `createNextgenMiddleware` |
| `ZitadelLoginSolidProps`, `…ReactProps`, `…SvelteProps` (and Logout, Session) | `ZitadelLoginProps` (and Logout, Session) |

`sdk-angular` gains `getApi` and `getZitadelConfig`, and `sdk-next` gains
`getZitadelConfig`.

## Consequences

The renames break every app that imports the old names. The SDKs are not
public yet, and the CLI's scaffolders, the demos, the conformance fixtures and
the docs change in the same release, so no generated app uses an old name.
