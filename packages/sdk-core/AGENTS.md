# Agent Instructions — `packages/sdk-core`

The SDK rules: [`../AGENTS.md`](../AGENTS.md). The public API standard:
[ADR 090](../../docs/adrs/090-sdk-public-api-standard.md).

## The seam to the API package

`sdk-core` is the only SDK that touches `@zitadel/api`. An SDK reads the
project configuration from `@zitadel/sdk-core/config`.

- **Import `@zitadel/api` only in `sdk-core`.** The generated client changes
  with the OpenAPI document; an SDK must not change with it.
- **Declare a name an app can see by hand,** never re-export a generated type
  (`ZitadelFlowStep`, or `ZitadelProject` in `config.ts`).
- **Add a check next to every hand-written type** that the generated type still
  fits it (`types.spec.ts`, `config.spec.ts`), and keep the field set small.
- **Keep a field out of `ZitadelFlowStep` unless an app needs it.** A
  first-party app that needs more names the generated type itself.
- **Mark a helper that only SDKs use `@internal`** (`widgetTags`,
  `standardAttributes`, the `*EventMap` types); no SDK re-exports it.
- **Link from a re-exported type only to names every SDK exports,** and write
  a default with `@defaultValue` on every `ZitadelMiddlewareOptions` property.
- **Do not add a handler name here.** Each meta-framework SDK names its own
  server entry after its framework; see the SDK rules.

## Growing the public types

- **Handle a closed union the server may grow with a default branch:**
  `ZitadelFlowPurpose`, `ZitadelFlowBehavior`, `ZitadelSessionStatus` and
  `ZitadelSessionErrorCode`; say so in the TSDoc of each.
- **Add a new field to an options or state interface as optional,** so no
  existing caller breaks; an output type only gains fields.
- **Put a new connection setting on `ZitadelProject` and `ZitadelConfig`,**
  never as a new flat shortcut option on an SDK.

## The contract spec and its cache

- List every file `src/contract.spec.ts` reads in the `test` inputs of `turbo.json`;
  a file it reads but turbo does not hash lets a cached pass hide drift.
- `scripts/task-graph.test.mjs` fails when a change to an SDK's `public-api.json` or
  entry source does not move the hash of `@zitadel/sdk-core#test`.
- Locate packages from `import.meta.dirname`, never `process.cwd()`: a wrong
  directory makes the tables empty and the guards silently vanish.

## Session cookies

- **A session token needs no escaping in a cookie.** The server issues a JWE in compact form, and a
  JWT has the same shape: base64url segments joined by `.`, so it holds no `%`, `+` or `=`, and
  `serializeSessionCookie` writes the value raw in every SDK.
