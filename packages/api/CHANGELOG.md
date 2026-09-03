# @zitadel/api

## 1.0.0-alpha.20

## 0.1.0-alpha.19

### Minor Changes

- [#900](https://github.com/zitadel/nextgen/pull/900) [`e26f376`](https://github.com/zitadel/nextgen/commit/e26f37617f5d3a3f92f00c07aad89a98ee9d754f) Thanks [@vitorbari](https://github.com/vitorbari)! - Nest a user's schema-defined content under `attributes`. `POST /users` takes `schema` plus an `attributes` document, and every user response carries `id`, `schema`, `attributes` and `metadata`. The user schema now validates `attributes` alone, so closed-world keywords such as `additionalProperties: false` behave as their author intended and a schema may declare a property named `id` or `metadata`. The schema pointer is named `schema` rather than `$schema`, and `POST /users` answers with the same representation a read returns.

  A user is stored as its attribute rows, so an empty `attributes` document is
  rejected with `user.invalid`, even where the schema itself accepts it. `POST
/users` also documents its `500`: when the user was created but could not be
  read back, the body carries its id in `details.user_id`, and the caller should
  fetch that user rather than repeat the create.

### Patch Changes

- [#856](https://github.com/zitadel/nextgen/pull/856) [`b17b2c9`](https://github.com/zitadel/nextgen/commit/b17b2c9fb3fae00f99a1864d37f3b51142ea4344) Thanks [@fforootd](https://github.com/fforootd)! - The package documentation now matches what the packages actually do. The Next and Nuxt guides drop the removed `api-base` attribute in favor of `configureZitadel()` and the `project` property; the Nuxt guide documents the Nuxt module (what `zitadel setup` wires) with its real options and the `useAuth()` / `useZitadelProject()` composables, alongside the hand-rolled middleware path with its full option set. `@zitadel/sdk-core` and `@zitadel/api` gain real documentation of their entry points, `@zitadel/config` gains a package README, and the SPA guides document the `ZitadelSession` card and point local no-proxy experiments at the local runtime's actual default port (8080). The flow-editing guide copied into `.zitadel/flows/` no longer suggests cross-flow `switch`/`pivot` transitions, which the runtime does not execute yet, and API examples use the real prefixed ID format (`proj_…`, `team_…`) instead of a retired naming scheme.

- [#829](https://github.com/zitadel/nextgen/pull/829) [`fc3d154`](https://github.com/zitadel/nextgen/commit/fc3d154f2fabb722c6f94633fd6c10bc60d0a657) Thanks [@fforootd](https://github.com/fforootd)! - Preserve purpose across in-card navigation: a flow transition can declare a
  local `purpose` (`{"target": "register", "purpose": "register"}`), and taking
  it moves the flow's dispatch mode while the original purpose stays pinned.
  The default login flow (and the passkey-first preset) now ship visible
  "Sign up" / "Sign in" navigations on their entry steps built on this —
  previously the only in-card path to registration was submitting an unknown
  email. Validators (server-side and `@zitadel/config`) enforce that the purpose
  is one the definition serves, that the transition targets that purpose's entry
  step, and that `purpose` never combines with the cross-flow `action`. Navigate
  actions now also clear a pending passkey challenge, so an abandoned prompt
  cannot re-attach after navigating away.

  Existing scaffolded apps keep their local `.zitadel/flows/default-login.json`
  unchanged (local config stays authoritative). To adopt the in-card
  navigations, add the two navigate actions and their purposed transitions to
  your flow file — or re-eject the default — then `zitadel plan` / `apply`.

## 0.1.0-alpha.18

### Minor Changes

- [#739](https://github.com/zitadel/nextgen/pull/739) [`7120ce3`](https://github.com/zitadel/nextgen/commit/7120ce328eb9c63bbc6ff0bad0465c7f1f49e602) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Add the project claim lifecycle endpoints to the API: `POST /projects/{project_id}/claim/init`, `GET /projects/{project_id}/claim/status`, and `POST /projects/{project_id}/claim/complete`, with matching methods on the generated `@zitadel/api` client. These let a developer start a claim from the CLI, poll its status, and finish it from the browser. The status response is modelled as discriminated `pending`/`completed` variants, and the contract carries the `proj.already_claimed` (409) and `proj.claim_expired` (410) error codes plus `429` rate-limit responses on polling and completion. The server handlers arrive separately, so the operations currently respond `501 Not Implemented`.

- [#637](https://github.com/zitadel/nextgen/pull/637) [`7ea32f8`](https://github.com/zitadel/nextgen/commit/7ea32f82b582e37944535b537940f035bdda8cde) Thanks [@wim07101993](https://github.com/wim07101993)! - Add `DELETE /users/{user_id}` to delete a user from a project. Requires an OAuth2 bearer with the `user.write` scope and returns `204 No Content`.

- [#778](https://github.com/zitadel/nextgen/pull/778) [`2c63b47`](https://github.com/zitadel/nextgen/commit/2c63b47c025e1255683b0b8cd2c48a3e25f79b3a) Thanks [@wim07101993](https://github.com/wim07101993)! - Drop the OIDC/OAuth surface from the OpenAPI contract. The spec described
  discovery, authorize, token, keys, userinfo, revoke, introspect, device
  authorization, and end-session endpoints that this server does not serve,
  so the generated clients advertised operations that could never succeed.

  Removed operations from the generated `@zitadel/api` client:
  - `getOpenIDConfiguration`, `authorizeGet`, `authorizeDevice`, `getToken`,
    `getUserInfo`, `getKeys`, `revokeToken`, `introspect`, `endSession`
  - `submitFlowEvent` (`POST /flow/{id}/event`)
  - `activateFlowDefinition` / `deactivateFlowDefinition`
    (`POST /flow_definitions/{id}/activate` and `/deactivate`)

  The `usernamePassword` security scheme is gone with them; `oauth2` and
  `nextgenSession` are unchanged.

  Sign-out is the `revokeMySession` operation (`DELETE /sessions/me`). JWKS
  for local development is still served by `@zitadel/api-mock` at
  `/auth/keys`, but as a mock-only route rather than a contract operation.

- [#777](https://github.com/zitadel/nextgen/pull/777) [`1f66979`](https://github.com/zitadel/nextgen/commit/1f6697956ee81a5a28812905283ddb94f649250f) Thanks [@wim07101993](https://github.com/wim07101993)! - Add operation-specific error response schemas to the OpenAPI spec, so the
  generated client exposes typed error models per endpoint.

  Each operation's error set is inferred from the implementation rather than a
  hand-maintained doc comment, and the inference now starts at the API handler
  instead of the service it calls. That closes two gaps where an endpoint could
  return an error its schema did not list — the authorization guard's
  `not_found` / `permission_denied`, raised before any service is reached, and
  the transport's `auth.unauthorized` / `req.invalid`, raised before a handler
  runs at all. Because the generated client discriminates the error response on
  `code`, an omitted code made a real response fail to decode instead of
  surfacing as the error it is.

  `auth.unauthorized` is listed only where the operation declares a security
  requirement, so the health probes and the pre-authentication flow steps no
  longer advertise an answer they cannot give.

- [#640](https://github.com/zitadel/nextgen/pull/640) [`e0b8d3d`](https://github.com/zitadel/nextgen/commit/e0b8d3d66356f80d658198edccca3d6d77077c29) Thanks [@wim07101993](https://github.com/wim07101993)! - Add `GET /users/{user_id}/passkeys` to list a user's registered passkeys,
  returning each passkey's `id`, `name`, and `created_at`. Requires an OAuth2
  bearer with the `user.read` scope.

  Registered passkeys now get a name of their own instead of reusing the user's
  display name, which was the same for every passkey a user registered (and empty
  whenever the flow collected no identifier). A passkey takes the name the
  registering caller supplies, and otherwise one derived from the credential
  itself: `Security key`, `Synced passkey`, or `Device-bound passkey`.

- [#752](https://github.com/zitadel/nextgen/pull/752) [`97470b2`](https://github.com/zitadel/nextgen/commit/97470b2d51fdf815463336ffe7999f864e510f13) Thanks [@wim07101993](https://github.com/wim07101993)! - New endpoint `GET /users/{user_id}/teams` serves a user's team roster, so a
  client can finally get from a user to the teams they belong to.

  Each entry is `{ id, name, membership_status, created_at, updated_at }`. The
  team's **name** travels with the entry, so a page of the roster renders without
  a follow-up `POST /teams/query` per row. Entries come back ordered by team name
  and page with `limit` / `page_token` like the other list endpoints;
  memberships the user was removed from are not returned. An unknown user is a
  404, which is a different answer from a user with an empty roster.

  The user read endpoints (`GET /users`, `GET /users/{user_id}`,
  `GET /users/me`) also gain `metadata.lifecycle_owner_team_id` — the single team
  that owns the user's identity lifecycle, or `null` when the user is self-owned.
  That is a different concept from the roster and the two need not agree
  (ADR 024): roster membership is collaboration, lifecycle ownership decides who
  may deprovision the user. The roster itself stays out of the user payload; it
  is unbounded, so it gets its own paginated resource.

- [#580](https://github.com/zitadel/nextgen/pull/580) [`e58a4c1`](https://github.com/zitadel/nextgen/commit/e58a4c1161d11d519d04cb944ab2875270ddc8c2) Thanks [@fforootd](https://github.com/fforootd)! - The management API (schemas, flow definitions, users, teams, project
  queries — the operator plane of ADR 036) now enforces the access model
  settled for branding in ADR 037, closing two holes:
  - **Project binding with anti-oracle responses.** Every management
    operation requires the bearer to be bound to the requested project;
    before, any project's secret could read and write any other project's
    schemas, flow definitions, users, and teams (including setting user
    passwords). Foreign projects answer exactly like nonexistent ones, so
    project ids cannot be probed.
  - **The browser plane is locked out.** The preview secret ships to
    visitors' browsers by design (`project.read` only); it can no longer
    call any management operation — previously it could create schemas,
    manage flow definitions, list users, and set passwords. Denials are
    `403 <resource>.permission_denied`.

  Contract fixes that ride along: `createTeam` was declared `security: []`
  (callable with no credential at all) and now requires the bearer with
  `team.write`; the drifted `users.read`/`teams.read` scope names are
  normalized to `user.read`/`team.read`; the oauth2 scheme's scope
  registry now lists the team and flow-definition scopes. `project.write`
  implies the finer per-resource scopes until ADR 036's credential planes
  make them mintable.

- [#649](https://github.com/zitadel/nextgen/pull/649) [`4b984af`](https://github.com/zitadel/nextgen/commit/4b984afbbde622b6f86d90ff327f4b21f9526785) Thanks [@wim07101993](https://github.com/wim07101993)! - Give every project a full key set at creation. The project key encryption key (KEK) now wraps purpose-scoped keys — token, secret and cookie encryption plus an EdDSA token signing key — and callers resolve them by purpose instead of sharing a single data-encryption key. Adds a `signing_keys` table and per-purpose "one active key per project" constraints.

- [#617](https://github.com/zitadel/nextgen/pull/617) [`40c8537`](https://github.com/zitadel/nextgen/commit/40c8537efc12203fce05855b9536500a4a78621a) Thanks [@peintnermax](https://github.com/peintnermax)! - Add publishable-key support (ADR 036, first slice): `configureZitadel()` and the `ZitadelProject` handle accept an optional browser-safe `publishableKey`, which `getApi()` sends as the bearer on every call from that handle — enabling the browser to authenticate the handoff exchange without server-side secret injection. The server's console runtime document (`GET /console/runtime.json`) now serves the default project's publishable key (the origin-scoped preview credential, `project.read` only) alongside the project id, and the embedded console's login widget uses it.

- [#672](https://github.com/zitadel/nextgen/pull/672) [`f2cec14`](https://github.com/zitadel/nextgen/commit/f2cec1417437c4f7d33dc4bd2281b802cfebe406) Thanks [@grvijayan](https://github.com/grvijayan)! - Rename a team with `PATCH /teams/{team_id}`. The name is trimmed and must be 1 to 200 characters. It must be unique within the project ignoring case, so a taken name returns 409. Only active teams can be renamed: a deactivated or unknown team returns 404. `createTeam` now declares its 403 and 404 responses, which were missing from the contract. The team response schema is now shared between `getTeam` and `updateTeam`, renaming the generated `GetTeamResponse` type to `TeamResponse`.

- [#563](https://github.com/zitadel/nextgen/pull/563) [`41a2de2`](https://github.com/zitadel/nextgen/commit/41a2de240cb446cd12b438a442a55e7b90287e80) Thanks [@fforootd](https://github.com/fforootd)! - Tenant-customizable login templates land end to end (ADR 040): eject a
  design, edit real Liquid, `plan`/`apply` publishes it, and the login
  renders it.
  - `@zitadel/server`: new Branding API (`POST /branding`,
    `GET /branding`, `GET /branding/{id}`) storing immutable per-project
    branding revisions with a lexical template gate (size, encoding,
    `<script>`/`<style>`, inline handlers, `javascript:` URLs, `| raw`).
    Flow responses now resolve the latest revision per project instead of
    the hardcoded default.
  - `@zitadel/api`: generated client and zod schemas for the Branding API.
  - `@zitadel/config`: the authoritative LiquidJS template validator
    (`@zitadel/config/template`), the `branding.json` config dialect
    meta-schema, and the ejectable design catalog (`centered`, `split`,
    `split-right`, `minimal`) with `getDefaultBrandingConfig`.
  - `@zitadel/components`: split/minimal layout chrome for the design
    catalog; the `{% mandatory_gates %}` tag name is now single-sourced
    from `@zitadel/config/template`.
  - `@zitadel/cli`: `.zitadel/branding/` becomes a synced resource — a
    `branding.json` descriptor plus a sibling `login.liquid` the CLI
    inlines on upload. `zitadel branding eject [--design <name>]`
    scaffolds it, `zitadel setup --design <name>` does so at setup and
    publishes revision 1, and `plan`/`apply` validate templates with the
    authoritative validator and publish edits as new revisions.

- [#721](https://github.com/zitadel/nextgen/pull/721) [`2975c4d`](https://github.com/zitadel/nextgen/commit/2975c4dabec68ac1a8569d6a34960de50dced1b8) Thanks [@wim07101993](https://github.com/wim07101993)! - Every user the API returns now carries its `id` and a read-only `metadata`
  object with `createdAt`, `updatedAt`, and `status` (`active`, `suspended`,
  `deactivated`, or `pending_purge`). `GET /users`, `GET /users/{user_id}`, and
  `GET /users/me` all serve this same typed `User` shape instead of an untyped
  object, so the generated clients describe the fields rather than handing back a
  free-form map.

  Two changes to `GET /users` need action:
  - Pagination moved from `offset` to `page_token`. Pass the `next_page_token`
    from the previous response instead of an offset; `offset` no longer exists.
    `limit` is unchanged.
  - The response is an object — `{ "users": [...], "next_page_token": "..." }` —
    rather than a bare array, and users come back newest-first instead of
    oldest-first. `next_page_token` is absent on the last page.

  `POST /users` now rejects a body that sets `id` or `metadata`; both are
  server-owned.

### Patch Changes

- [#558](https://github.com/zitadel/nextgen/pull/558) [`d2bca36`](https://github.com/zitadel/nextgen/commit/d2bca36bdaa09168363e8e581cc4f0ef5db7eeb8) Thanks [@fforootd](https://github.com/fforootd)! - Strip trailing slashes from base URLs with an `endsWith` loop instead of a
  regex CodeQL flags as polynomial on uncontrolled input.

## 0.1.0-alpha.17

## 0.1.0-alpha.16

### Minor Changes

- [#524](https://github.com/zitadel/nextgen/pull/524) [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19) Thanks [@fforootd](https://github.com/fforootd)! - `GET /sessions/me` now returns the signed-in user's `name` and `email` alongside `user_id`, hydrated from the conventional user-schema attributes (`name`, or `given_name` + `family_name`, and `email`). Signed-in surfaces such as `<zitadel-session>` render the human-readable identity instead of the raw user ID; both fields stay absent for anonymous sessions and schemas without those properties.

### Patch Changes

- [#497](https://github.com/zitadel/nextgen/pull/497) [`e9593cd`](https://github.com/zitadel/nextgen/commit/e9593cd4f74f5ebc010150a2ed8a3ae03b7d5d87) Thanks [@fforootd](https://github.com/fforootd)! - The passkey origin-allowlist rejection now names the allowed origins (e.g. `origin "http://127.0.0.1:3000" is not allowed for this project (allowed: http://localhost:3000)`), and `<zitadel-login>` surfaces the server's error message instead of a generic "returned 400". `@zitadel/api` exports the new `apiErrorMessage` helper for extracting the server error envelope from an `ApiError`.

## 0.1.0-alpha.15

## 0.1.0-alpha.14

### Minor Changes

- [#341](https://github.com/zitadel/nextgen/pull/341) [`605abe1`](https://github.com/zitadel/nextgen/commit/605abe1f04a011c05bd4be2179556052eae6c007) Thanks [@fforootd](https://github.com/fforootd)! - Scaffold editable schema and flow config from shared local defaults, add project default seeding control, and seed sync state so plan is idempotent immediately after setup.

## 0.1.0-alpha.13

### Patch Changes

- [#417](https://github.com/zitadel/nextgen/pull/417) [`b574f3a`](https://github.com/zitadel/nextgen/commit/b574f3a6e6122439fadd6f971b73a61b8554f293) Thanks [@fforootd](https://github.com/fforootd)! - Label passkey registrations with collected identifiers and request discoverable credentials while keeping WebAuthn user handles opaque.

## 0.1.0-alpha.12

### Patch Changes

- [#386](https://github.com/zitadel/nextgen/pull/386) [`a2f6526`](https://github.com/zitadel/nextgen/commit/a2f65266e00ee461e8e7fb1dee35e5add30b7199) Thanks [@wim07101993](https://github.com/wim07101993)! - Fixed some examples which represent flow-definition-step in the openapi examples.

## 0.1.0-alpha.11

## 0.1.0-alpha.10

## 0.1.0-alpha.9

## 0.1.0-alpha.8

## 0.1.0-alpha.7

## 0.1.0-alpha.6

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
