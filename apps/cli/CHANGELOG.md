# @zitadel/cli

## 0.1.0-alpha.3

### Patch Changes

- [#272](https://github.com/zitadel/nextgen/pull/272) [`08b7ab4`](https://github.com/zitadel/nextgen/commit/08b7ab44f13e104545f17f6f94244eb825a4dcf5) Thanks [@fforootd](https://github.com/fforootd)! - Allow same-directory setup after starting the local Zitadel runtime.

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- [#265](https://github.com/zitadel/nextgen/pull/265) [`ceb74d5`](https://github.com/zitadel/nextgen/commit/ceb74d54c98fff07deb90c800a5aa08b2f46e30e) Thanks [@fforootd](https://github.com/fforootd)! - Derive alpha local runtime images from the installed CLI version, pin generated SDK dependencies to the same alpha train, and emit exact-version follow-up commands for reproducible tester reports.

- [#255](https://github.com/zitadel/nextgen/pull/255) [`ca53f61`](https://github.com/zitadel/nextgen/commit/ca53f61ae249f81fd301f71f33cd9be416271ad7) Thanks [@fforootd](https://github.com/fforootd)! - Make doctor local-runtime checks advisory for cloud setup, harden fresh Next.js scaffolding, auto-install setup dependencies, normalize public follow-up commands, and avoid assuming Next.js in local-runtime setup guidance.

- Updated dependencies [[`b0094f4`](https://github.com/zitadel/nextgen/commit/b0094f4255854c571664e746f70447c365c52af2)]:
  - @zitadel/api@0.1.0-alpha.2

## 0.1.0-alpha.1

### Minor Changes

- [#245](https://github.com/zitadel/nextgen/pull/245) [`85f90f2`](https://github.com/zitadel/nextgen/commit/85f90f29aa8976daa5267b42a3fed41b0c4bc57a) Thanks [@fforootd](https://github.com/fforootd)! - Add top-level `zitadel` commands for managing a Docker-backed local Zitadel runtime.

### Patch Changes

- [#228](https://github.com/zitadel/nextgen/pull/228) [`9e4c981`](https://github.com/zitadel/nextgen/commit/9e4c981fac960220643562a8c3c210b697269b48) Thanks [@fforootd](https://github.com/fforootd)! - Scaffold prerelease SDK dependencies on the same npm dist-tag as the CLI.

## 0.1.0-alpha.0

### Minor Changes

- [#158](https://github.com/zitadel/nextgen/pull/158) [`e86cf03`](https://github.com/zitadel/nextgen/commit/e86cf0392b93de1686cb829cf888a655139a60dc) Thanks [@mridang](https://github.com/mridang)! - Drop unused auth methods from the `zitadel setup` prompt and consolidate flow domain logic into `apps/cli/src/lib/flows/`. The setup prompt previously offered `passkey`, `password`, and `totp` as a multiselect, but `totp` is not a valid key under `x-auth-methods` per the OAS spec (only `password|passkey|magic_link|sso|otp` are allowed with `additionalProperties: false`), so any user schema written with `totp` selected failed validation. The Go flow engine only wires `password` and `identifier` challenges today; `passkey` has a defined JSON shape but no runtime handler yet.

  **Breaking change for non-interactive callers.** The `--auth-methods` flag (CSV) has been renamed to `--auth-method` (single value); allowed values are `passkey` (default) or `password`. Agents and scripts that previously passed `--auth-methods password` must update to `--auth-method password`.

  Internally, the flow_definition shape (Zod schema, types, build, read/write, text-key extraction) now lives behind a single `apps/cli/src/lib/flows/` module exported through one barrel. The sync layer remains shape-agnostic and treats flow payloads as opaque bytes. A follow-up PR will introduce `apps/cli/src/lib/user-schema/` mirroring the same layout.

- [#150](https://github.com/zitadel/nextgen/pull/150) [`5761ad2`](https://github.com/zitadel/nextgen/commit/5761ad2a2914d328203f5863b120e95300c60a22) Thanks [@mridang](https://github.com/mridang)! - Remove the pre-claim / claim lifecycle from the CLI and api-mock. The `zitadel claim` and `zitadel claim status` commands, the `ClaimClient` interface, the `InitClaim*` / `ClaimStatus*` schemas, the `claimed_at` / `team_id` fields on `.zitadel/secret`, the `E_CLAIM_REQUIRED` and `E_PLATFORM_HANDOFF` error codes, the production-claim gates in `apply` and `deploy connect`, and the api-mock's `claim/init` / `claim/status` handlers and `completeMockClaim()` export are all gone. The SDK's `resolveZitadelRuntime` production-issuer error message no longer references the removed `zitadel claim` command. `/projects/{id}/claim/init` and `/projects/{id}/claim/status` are not in the OpenAPI spec and have no backend; the surface only worked against the mock.

- [#157](https://github.com/zitadel/nextgen/pull/157) [`c2e8aa8`](https://github.com/zitadel/nextgen/commit/c2e8aa8a73c7c2a228adcf56b35256c4b7c8f9b3) Thanks [@mridang](https://github.com/mridang)! - `zitadel setup` now scaffolds a `middleware.ts` at the project root that wires up `nextgenMiddleware` from `@zitadel/sdk-next`. The middleware forwards `/__nextgen/*` same-origin to `NEXTGEN_ISSUER_URL` (the auth backend) and gates `/profile` behind a JWT check.

  The file uses the `middleware.ts` + `function middleware()` convention because Next 15 only recognises that form; Next 16 accepts it too (the `proxy.ts` rename is deprecated-but-backwards-compatible). Using the universal form means one template works on every supported Next major.

  Scaffolded pages now use `api-base="/__nextgen"` instead of pointing at the backend URL directly, so no CORS configuration is needed and the backend URL never reaches the browser bundle. `.env.local` no longer writes `NEXT_PUBLIC_ZITADEL_API_BASE`; it writes `NEXTGEN_ISSUER_URL` (the same value, server-side only). `doctor --fix` re-applies `middleware.ts` if missing.

- [#208](https://github.com/zitadel/nextgen/pull/208) [`e7ec7e9`](https://github.com/zitadel/nextgen/commit/e7ec7e9f2e9e9559ddc1b728a0c7a5e6fb0d08fb) Thanks [@mridang](https://github.com/mridang)! - `zitadel setup` no longer scaffolds or uploads the user schema and flow definition — the Zitadel server now provisions these defaults when a project is created. Setup no longer writes `.zitadel/schemas/user.json` or `.zitadel/flows/default.json`, runs no sync step at the end, and the `--no-apply` flag (which only gated that sync) has been removed. The sync engine and the hidden `apply`/`plan` commands remain in place for a future pull-based workflow.

  **Behavior change for non-interactive callers.** `zitadel setup --no-apply` is no longer a valid flag and will error; remove it from scripts and agents.

  Scaffolded Next.js login/register/profile pages now configure the SDK via `configureZitadel(...)` and pass the resulting project handle to the `<zitadel-login>` / `<zitadel-logout>` web components through the `project` prop, instead of the removed `api-base` / `project-id` attributes. To support an app that declares only `@zitadel/sdk-next` as a direct dependency, `@zitadel/sdk-next/client` now re-exports `configureZitadel` and `getApi`.

- [#209](https://github.com/zitadel/nextgen/pull/209) [`fdabcff`](https://github.com/zitadel/nextgen/commit/fdabcffb28a0058375d97f671152ebb3075f3703) Thanks [@bastionstack](https://github.com/bastionstack)! - Rename the public packages to the `@zitadel` scope and publish them to npm via changesets with GitHub OIDC trusted publishing. This is the first `@zitadel/*`-scoped release line, cut as an `alpha` prerelease.

### Patch Changes

- [#206](https://github.com/zitadel/nextgen/pull/206) [`3aa1d5f`](https://github.com/zitadel/nextgen/commit/3aa1d5f62af87fe4b6658dbed914bac515e3f0de) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Document the default fresh-app credential journey and refine the component copy
  and password autocomplete behavior for registration flows.

- [#11](https://github.com/zitadel/nextgen/pull/11) [`98f9a6f`](https://github.com/zitadel/nextgen/commit/98f9a6f30c0419c6cb50eb53f2eea760380246d6) Thanks [@conblem](https://github.com/conblem)! - Adopt the CLI to the Nx lint and strict TypeScript CI checks.

- Updated dependencies [[`3aa1d5f`](https://github.com/zitadel/nextgen/commit/3aa1d5f62af87fe4b6658dbed914bac515e3f0de), [`fdabcff`](https://github.com/zitadel/nextgen/commit/fdabcffb28a0058375d97f671152ebb3075f3703)]:
  - @zitadel/api@0.1.0-alpha.0
