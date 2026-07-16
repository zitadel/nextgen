# @zitadel/server

## 0.1.0-alpha.17

### Patch Changes

- [#544](https://github.com/zitadel/nextgen/pull/544) [`79d4179`](https://github.com/zitadel/nextgen/commit/79d417924518c9ea272136db1f46aaf237497999) Thanks [@fforootd](https://github.com/fforootd)! - Fixes from alpha.16 community feedback:
  - Custom schema fields now render a readable label. A property with no
    catalog entry (e.g. `department`, `dateOfBirth`) falls back to a
    humanised name ("Department", "Date of birth") on the form instead of
    leaking the raw `<step>.field.<name>` text key. A catalogued key still
    wins, so localised labels are unaffected.
  - The scaffolded `.zitadel/flows/README.md` no longer contains the
    "Presets" section twice.
  - The `warn/default-flow-swap` plan warning now leads with the impact in
    plain language: the new flow becomes the default for its purposes, and
    every page that does not explicitly set `flow-name` on
    `<zitadel-login>` will start rendering it — scope it via `audience`
    or pin `flow-name` to opt out.
  - The flip-table validation error (login/register entry step missing its
    `user_not_found`/`user_already_exists` transition) now explains who
    gets stuck where: someone without an account would be stuck at
    sign-in instead of being routed to registration, and vice versa. Plan,
    apply, and the server report the same wording.

- [#525](https://github.com/zitadel/nextgen/pull/525) [`363482e`](https://github.com/zitadel/nextgen/commit/363482e27c88ac96c9a2b48c880e5caa5a4dcf65) Thanks [@fforootd](https://github.com/fforootd)! - Every engine-emitted step error is now a localizable `error.*` catalog
  key — no `auth_attempt.*` literals leak into the login UI anymore.
  Rejected passkey proofs emit `error.passkey_invalid` (assertion) and
  `error.passkey_registration_invalid` (attestation), translated in every
  builtin locale; rejected password submissions emit the existing
  `error.invalid_credentials`, which the login component routes inline to
  the password field. The `step.error` contract docs now describe the
  `error.*` catalog plus verbatim outcome tokens (e.g. `user_not_found`)
  instead of citing `auth_attempt.*` diagnostics.

## 0.1.0-alpha.16

### Minor Changes

- [#462](https://github.com/zitadel/nextgen/pull/462) [`99395d1`](https://github.com/zitadel/nextgen/commit/99395d1ae038643bc664033281f4c9999e675975) Thanks [@wim07101993](https://github.com/wim07101993)! - Add project list and patch endpoints to the API.

- [#524](https://github.com/zitadel/nextgen/pull/524) [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19) Thanks [@fforootd](https://github.com/fforootd)! - `GET /sessions/me` now returns the signed-in user's `name` and `email` alongside `user_id`, hydrated from the conventional user-schema attributes (`name`, or `given_name` + `family_name`, and `email`). Signed-in surfaces such as `<zitadel-session>` render the human-readable identity instead of the raw user ID; both fields stay absent for anonymous sessions and schemas without those properties.

### Patch Changes

- [#522](https://github.com/zitadel/nextgen/pull/522) [`9de949d`](https://github.com/zitadel/nextgen/commit/9de949d8e9376a63da5dccc23044cdf40264123f) Thanks [@livio-a](https://github.com/livio-a)! - Align request logging with ADR 030: expected 4xx responses log at `Warn` with `error_code` (parsed from the wire envelope only), 5xx at `Error`, and raw response bodies are no longer written to logs.

- [#495](https://github.com/zitadel/nextgen/pull/495) [`e4d55d2`](https://github.com/zitadel/nextgen/commit/e4d55d22c64d28a19597718417af6447a66a5852) Thanks [@fforootd](https://github.com/fforootd)! - Fix the duplicate "Continue with passkey" button: flow responses no longer embed a stale copy of the default login template. The login widget renders the up-to-date template bundled with `@zitadel/components`, which also brings checkbox/select field rendering and the empty-subtitle guard to real flows. A tenant-provided `branding.liquid_template` still takes precedence.

- [#526](https://github.com/zitadel/nextgen/pull/526) [`62a7982`](https://github.com/zitadel/nextgen/commit/62a79824e9574eaad1f478ef3b6d51badb4d1355) Thanks [@wim07101993](https://github.com/wim07101993)! - Default password/secret hashing is now `argon2id` (RFC 9106 second recommended
  option: `time=3`, `memory=64 MiB`, `threads=4`) instead of bcrypt, per ADR 029.
  Bcrypt and legacy algorithms (scrypt, pbkdf2, sha2, md5, md5salted, phpass,
  drupal7, argon2) stay registered as verifiers, so pre-existing hashes keep
  validating and are transparently rehashed to argon2id on the next successful
  verification. Configure `password_hasher.hasher.algorithm` (and
  `password_hasher.verifiers`) to override — e.g. set `bcrypt` with `cost: 10` to
  keep the previous behavior.

- [#521](https://github.com/zitadel/nextgen/pull/521) [`e4809a3`](https://github.com/zitadel/nextgen/commit/e4809a30d21ae9ca400e58d2ccbb7078c2d3efff) Thanks [@livio-a](https://github.com/livio-a)! - Implement ADR 030 error-reporting foundation: `internal/errreport` capture toggles, `domain.Error` refinements (`Unwrap`, message-only `Error()`, structured `LogValue` with `Origin`), and instrumentation wiring for location/stack/GCP reporting.

- [#524](https://github.com/zitadel/nextgen/pull/524) [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19) Thanks [@fforootd](https://github.com/fforootd)! - Flow field validation errors now travel as localisation keys instead of
  developer strings: `step.error` carries `error.<field>_<rule>` per violation
  ("; "-joined, format spelled `_invalid` to match the catalog), and the login
  components localise them — catalog-known keys render inline on their field,
  unknown fields resolve through new generic `error.field_<rule>` fallbacks
  interpolated with the step's field label (en/de/it). A key routed inline whose
  field is not on the step downgrades to a visible banner message instead of
  disappearing. Users see "Please enter a valid email" instead of
  "flow field email: format".

- [#514](https://github.com/zitadel/nextgen/pull/514) [`1eec59e`](https://github.com/zitadel/nextgen/commit/1eec59ee924cc2b12df11f5541d6a2eef8caa6c2) Thanks [@fforootd](https://github.com/fforootd)! - Select a flow definition by name. `<zitadel-login>` gains a `flow-name`
  attribute (`flowName` prop on every framework wrapper) that sends
  `flow_definition_name` on flow start, so a project with several synced
  flows can run a specific one instead of the audience-resolved default.
  An unknown name or a purpose mismatch surfaces as a clear startup error
  naming the attribute. Audience selection itself is now honored and
  deterministic: hinted app beats hinted team beats the newest unscoped
  flow, and a flow scoped to an app/team no longer captures the project
  default. The flows README and plan/apply docs explain how to add and
  select a second flow.

  Because newest-unscoped-wins means a new flow can silently take over the
  default login, `plan` warns on any create of an active, unscoped flow in
  a project that already has flows (`warn/default-flow-swap`, a
  non-blocking `# warning:` line and a `--json` warnings entry) — scope
  the flow via `audience` or pin `flow-name` in the widget to opt out.
  The offline dialect gains the committed `auth-methods`/`auth-method`
  meta-schema copies that `user-schema.json` references, so editors
  resolve the full dialect without network access.

- [#515](https://github.com/zitadel/nextgen/pull/515) [`aeea830`](https://github.com/zitadel/nextgen/commit/aeea83071227816e2bf2d4ee6fb4597c70908459) Thanks [@fforootd](https://github.com/fforootd)! - Disabling passkey in the user schema (`x-auth-methods.passkey.enabled: false`)
  is now enforced for flows. A flow step declaring a `passkey` or
  `passkey_register` action against a schema that does not enable passkey fails
  validation at plan time (and on the server at apply time) with
  `step "…": action "…" offers passkey but "passkey" is not an enabled
authentication method` — the same treatment the `x-auth-methods#password`
  field already gets. Previously the schema toggle applied successfully but
  /login and /register kept offering and accepting passkeys.

  Definition time is the only enforcement point, matching every other flow
  rule: a flow pins its schema revision, and repinning re-validates, so a
  validated flow's verdict cannot change at runtime. Flows applied before this
  rule keep working as applied and surface the violation on their next
  plan/apply.

- [#497](https://github.com/zitadel/nextgen/pull/497) [`e9593cd`](https://github.com/zitadel/nextgen/commit/e9593cd4f74f5ebc010150a2ed8a3ae03b7d5d87) Thanks [@fforootd](https://github.com/fforootd)! - The passkey origin-allowlist rejection now names the allowed origins (e.g. `origin "http://127.0.0.1:3000" is not allowed for this project (allowed: http://localhost:3000)`), and `<zitadel-login>` surfaces the server's error message instead of a generic "returned 400". `@zitadel/api` exports the new `apiErrorMessage` helper for extracting the server error envelope from an `ApiError`.

- [#502](https://github.com/zitadel/nextgen/pull/502) [`bdf2906`](https://github.com/zitadel/nextgen/commit/bdf29064ab783f1d14ea554f3512bf243e86d3b5) Thanks [@fforootd](https://github.com/fforootd)! - Scaffolded projects now explain their own next step. `zitadel setup` writes
  an `AGENTS.md` guidance section for AI agents and an "Authentication
  (Zitadel)" section into the app README (marker-fenced — existing content is
  never clobbered), copies the flow/schema dialect meta-schemas into
  `.zitadel/meta/`, and scaffolds flow files with
  `"$schema": "../meta/flow-definition.json"` so editors validate and
  autocomplete flow edits offline. The `$schema` pointer is local-only: sync
  ignores it and write-back preserves it. `ZitadelLogin` wrappers gain typed
  `locales`/`lang` props for labelling custom flow steps (see the new
  "Customize copy" docs page).

  `zitadel eject` removes what setup wrote: the marker-fenced guidance section
  is stripped from `README.md`/`AGENTS.md` (content outside the markers is
  untouched), and a file is deleted only when nothing but the scaffold-created
  header would remain — no stale golden path survives pointing at deleted
  `.zitadel/` files.

  Every SDK wrapper now forwards `locales`/`lang` to the widget (previously
  only React did; Solid/Qwik/Svelte accepted and discarded them, Vue/Angular
  did not expose them). The flow dialect meta-schema (`@zitadel/server`
  embeds it; `@zitadel/config` ships the committed copy) marks a transition's
  `action` as nullable, matching the OpenAPI contract — editors no longer
  flag `"action": null`.

- [#492](https://github.com/zitadel/nextgen/pull/492) [`75b61e1`](https://github.com/zitadel/nextgen/commit/75b61e1f431bdd91f6e97dce4a87d51cd9d8a152) Thanks [@fforootd](https://github.com/fforootd)! - Model the `__nextgen_session` cookie as an OpenAPI security scheme
  (`nextgenSession`) on `GET /sessions/me`, `DELETE /sessions/me`, and
  `GET /users/me` instead of a required cookie parameter. Credential absence is
  now a security failure by construction, and a cookie that fails token
  verification returns `401 auth.unauthorized` (previously `401
sess.token_invalid`), matching the missing-cookie case.

- [#516](https://github.com/zitadel/nextgen/pull/516) [`85f5044`](https://github.com/zitadel/nextgen/commit/85f504491a10f0b41b99c123e91df1f41c2d5763) Thanks [@fforootd](https://github.com/fforootd)! - Setup and status guidance now tracks where you are in the journey. The
  `zitadel setup` terminal box ends on the verify mission (install, start,
  register → sign out → sign in) plus a single breadcrumb to `zitadel status`
  and the README's Zitadel section, instead of listing customize/publish steps
  before the first login. The `--json` envelope keeps the complete
  `next_actions`/`next_commands` for agents. `zitadel status` asks the platform
  whether the project has users yet: none → verify-login guidance, some → the
  customize (.zitadel/schemas/, .zitadel/flows/) and plan/apply publish steps;
  when the server is unreachable it keeps the lifecycle-only output.
  `next_commands` is staged in lockstep: before the first proven login it
  offers `plan` and withholds `apply`.

  The server implements `GET /users` (previously generated-but-unimplemented,
  returning 500): bearer-scoped to the token's project — the exact call shape
  of the status probe — returning attribute-hydrated users with a stable
  creation-ordered `offset`/`limit` window (spec defaults limit 20, max 100).
  The staged status therefore works against a real runtime, not only the
  api-mock.

## 0.1.0-alpha.15

### Patch Changes

- [#488](https://github.com/zitadel/nextgen/pull/488) [`6e4a11a`](https://github.com/zitadel/nextgen/commit/6e4a11a7cd07587a51362d751fcc0320b00a4301) Thanks [@fforootd](https://github.com/fforootd)! - Unauthenticated requests to cookie-secured endpoints (`GET`/`DELETE /sessions/me`, `GET /users/me`) now return `401` with the stable code `auth.unauthorized` instead of `400 req.invalid`, matching the documented OpenAPI contract. API error responses no longer serialize internal diagnostics (`parent`, `location`) into `details`, and security errors return a normalized message instead of raw framework text.

## 0.1.0-alpha.14

### Minor Changes

- [#341](https://github.com/zitadel/nextgen/pull/341) [`605abe1`](https://github.com/zitadel/nextgen/commit/605abe1f04a011c05bd4be2179556052eae6c007) Thanks [@fforootd](https://github.com/fforootd)! - Scaffold editable schema and flow config from shared local defaults, add project default seeding control, and seed sync state so plan is idempotent immediately after setup.

### Patch Changes

- [#456](https://github.com/zitadel/nextgen/pull/456) [`eedc8fe`](https://github.com/zitadel/nextgen/commit/eedc8fe94a850fb2c7173c0b782bcae9d30817a1) Thanks [@wim07101993](https://github.com/wim07101993)! - Add schema correlation via `objectType`: schemas now persist this field, and
  `GET /schemas` can filter by `objectType`.

- [#434](https://github.com/zitadel/nextgen/pull/434) [`ddc0c13`](https://github.com/zitadel/nextgen/commit/ddc0c1323ac7eac7332344931fe7c077857f70dc) Thanks [@vitorbari](https://github.com/vitorbari)! - Fix passkey signup silently dropping every collected user attribute except the identifier. The passkey-register now routes user creation through `UserService`.

- [#453](https://github.com/zitadel/nextgen/pull/453) [`54dcc87`](https://github.com/zitadel/nextgen/commit/54dcc87084dd2d2b8314d08221354683bae64c6b) Thanks [@vitorbari](https://github.com/vitorbari)! - Add back navigation to interactive flows. The engine injects a `back` action on rendered step responses when there's a step to return to, and clears the back stack past irreversible mutations (user creation, passkey registration) and at flow termination.

## 0.1.0-alpha.13

### Patch Changes

- [#411](https://github.com/zitadel/nextgen/pull/411) [`720e526`](https://github.com/zitadel/nextgen/commit/720e526f0f29181b1ae5824dee18cf57b10bea3f) Thanks [@vitorbari](https://github.com/vitorbari)! - Drop the `x-password` user-property annotation. The flow engine sources the password challenge from the reserved `x-auth-methods#password` field name combined with `x-auth-methods.password.enabled` at the schema root (introduced in [#400](https://github.com/zitadel/nextgen/issues/400)); `x-password` is no longer read by any code path. Removed from the `user-property.json` meta-schema and the CLI's generated `password` preset; comments and docs updated to match.

- [#417](https://github.com/zitadel/nextgen/pull/417) [`b574f3a`](https://github.com/zitadel/nextgen/commit/b574f3a6e6122439fadd6f971b73a61b8554f293) Thanks [@fforootd](https://github.com/fforootd)! - Label passkey registrations with collected identifiers and request discoverable credentials while keeping WebAuthn user handles opaque.

## 0.1.0-alpha.12

### Patch Changes

- [#336](https://github.com/zitadel/nextgen/pull/336) [`f6279a0`](https://github.com/zitadel/nextgen/commit/f6279a0bac51447533a4a33eb33479b792558783) Thanks [@vitorbari](https://github.com/vitorbari)! - Fix flow engine: identifier outcomes (`user_not_found`, `user_already_exists`) now flip `CurrentPurpose` consistently across every dispatch path (including the passkey-issue path) and only when the routing transition is actually taken, preventing a phantom mode switch when no matching transition is wired.

- [#365](https://github.com/zitadel/nextgen/pull/365) [`9b05b82`](https://github.com/zitadel/nextgen/commit/9b05b82c3e7546ad3c4ebd4a025a991da499abf8) Thanks [@vitorbari](https://github.com/vitorbari)! - Fix flow engine: identifier dispatch now re-runs `SubmitIdentifier` on every request and drops any in-flight ceremony when the resolved user changes. This unblocks a passkey-login failure where two users sharing a browser session could not both authenticate without a refresh — the previous user's id stayed cached in flow state and short-circuited the lookup for the next attempt.

- [#403](https://github.com/zitadel/nextgen/pull/403) [`2b2cfd5`](https://github.com/zitadel/nextgen/commit/2b2cfd58f63d564c96fdc582c07e874297a5229c) Thanks [@vitorbari](https://github.com/vitorbari)! - Fix flow API: select-typed step fields now include their `validation.enum` in the response. The API mapper was dropping the resolver-derived enum, so clients rendering a `select` had no option values to display.

- [#400](https://github.com/zitadel/nextgen/pull/400) [`e5150f3`](https://github.com/zitadel/nextgen/commit/e5150f30dfc2b24230fa698bb99baeceb2841d00) Thanks [@wim07101993](https://github.com/wim07101993)! - Credentials are no longer modeled as user-schema properties — flow definitions reference them through `x-auth-methods` instead. A password field in a flow step is now `"x-auth-methods#password"`, sourced from the schema's `x-auth-methods` keyword, rather than a `password` user property carrying `x-password: true`.

- [#376](https://github.com/zitadel/nextgen/pull/376) [`5d18103`](https://github.com/zitadel/nextgen/commit/5d18103e677d31a5b9b7c93ea164bef53b3e6e96) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Fix the embedded hosted-login shell to call the Flow API on the same origin at `/flow`.

## 0.1.0-alpha.11

## 0.1.0-alpha.10

## 0.1.0-alpha.9

### Patch Changes

- [#325](https://github.com/zitadel/nextgen/pull/325) [`ae99992`](https://github.com/zitadel/nextgen/commit/ae999926df674eb7ca777e0273789b8f58f83a19) Thanks [@fforootd](https://github.com/fforootd)! - Forward normal shutdown signals from the npm server wrapper to the packaged Zitadel binary.

## 0.1.0-alpha.8

### Patch Changes

- [#319](https://github.com/zitadel/nextgen/pull/319) [`0547b8c`](https://github.com/zitadel/nextgen/commit/0547b8c397b1016e199fa16f0b208a7115720806) Thanks [@fforootd](https://github.com/fforootd)! - Cut a fresh alpha package train with the embedded UI release build fix.

## 0.1.0-alpha.7

### Patch Changes

- [#317](https://github.com/zitadel/nextgen/pull/317) [`0bacdf2`](https://github.com/zitadel/nextgen/commit/0bacdf23226a1e90c37f09b3cac245e1cf917091) Thanks [@fforootd](https://github.com/fforootd)! - Cut a fresh alpha package train after the release automation fixes.

## 0.1.0-alpha.6

### Minor Changes

- [#305](https://github.com/zitadel/nextgen/pull/305) [`2cf813e`](https://github.com/zitadel/nextgen/commit/2cf813e62d2d76346536911e3e4ccfe390fb3583) Thanks [@fforootd](https://github.com/fforootd)! - Publish the Zitadel server binary to npm through a wrapper package and platform-specific binary packages.
