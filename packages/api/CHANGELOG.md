# @zitadel/api

## 0.1.0-alpha.5

## 0.1.0-alpha.4

## 0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- [#268](https://github.com/zitadel/nextgen/pull/268) [`b0094f4`](https://github.com/zitadel/nextgen/commit/b0094f4255854c571664e746f70447c365c52af2) Thanks [@mridang](https://github.com/mridang)! - Fix `configureZitadel()` so its state survives when more than one copy of `@zitadel/api/config` ends up loaded — the standalone components bundle inlines its own copy, and dual-package hazards / duplicate `node_modules` trees in a monorepo can load a second copy alongside the app's. Previously each module instance held its own `let currentProject`, so a `configureZitadel()` call in one was invisible to `getZitadelConfig()` in another and the components silently saw no config. The slot now lives on `globalThis` under a `Symbol.for(...)` key, which the global symbol registry resolves to the same symbol identity in every copy of the module evaluated in the same JS realm — separate realms (iframes, Node `vm` contexts, worker threads) still have their own registries.

## 0.1.0-alpha.0

### Minor Changes

- [#206](https://github.com/zitadel/nextgen/pull/206) [`3aa1d5f`](https://github.com/zitadel/nextgen/commit/3aa1d5f62af87fe4b6658dbed914bac515e3f0de) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Wire up the end-to-end passkey registration and login flow across the
  API, component, and SDK surfaces:
  - `@zitadel/api`: expose the passkey registration OpenAPI contract to the
    generated TypeScript client.
  - `@zitadel/components`: refresh the `<zl-passkey>` atom and the
    `<zitadel-login>` orchestrator templates (consolidated `default.liquid` +
    `layout-chrome.css`, dropped the standalone passkey-upsell/signed-in
    partials) and expand the `en`/`de` locale strings for the passkey steps.
  - `@zitadel/sdk-next`: extend `auth` and the request `middleware` to drive the
    passkey register/login round-trip.
  - `@zitadel/sdk-core`: adjust JWT handling to support the flow.

- [#209](https://github.com/zitadel/nextgen/pull/209) [`fdabcff`](https://github.com/zitadel/nextgen/commit/fdabcffb28a0058375d97f671152ebb3075f3703) Thanks [@bastionstack](https://github.com/bastionstack)! - Rename the public packages to the `@zitadel` scope and publish them to npm via changesets with GitHub OIDC trusted publishing. This is the first `@zitadel/*`-scoped release line, cut as an `alpha` prerelease.
