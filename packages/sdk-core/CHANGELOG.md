# @zitadel/sdk-core

## 0.1.0-alpha.10

## 0.1.0-alpha.9

## 0.1.0-alpha.8

## 0.1.0-alpha.7

## 0.1.0-alpha.6

## 0.1.0-alpha.5

## 0.1.0-alpha.4

## 0.1.0-alpha.3

## 0.1.0-alpha.2

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

### Patch Changes

- [#150](https://github.com/zitadel/nextgen/pull/150) [`5761ad2`](https://github.com/zitadel/nextgen/commit/5761ad2a2914d328203f5863b120e95300c60a22) Thanks [@mridang](https://github.com/mridang)! - Remove the pre-claim / claim lifecycle from the CLI and api-mock. The `zitadel claim` and `zitadel claim status` commands, the `ClaimClient` interface, the `InitClaim*` / `ClaimStatus*` schemas, the `claimed_at` / `team_id` fields on `.zitadel/secret`, the `E_CLAIM_REQUIRED` and `E_PLATFORM_HANDOFF` error codes, the production-claim gates in `apply` and `deploy connect`, and the api-mock's `claim/init` / `claim/status` handlers and `completeMockClaim()` export are all gone. The SDK's `resolveZitadelRuntime` production-issuer error message no longer references the removed `zitadel claim` command. `/projects/{id}/claim/init` and `/projects/{id}/claim/status` are not in the OpenAPI spec and have no backend; the surface only worked against the mock.
