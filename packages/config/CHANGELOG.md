# @zitadel/config

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

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.17

## 0.1.0-alpha.16

### Patch Changes

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

- [#499](https://github.com/zitadel/nextgen/pull/499) [`1f2dcf6`](https://github.com/zitadel/nextgen/commit/1f2dcf647cc4d3b96275b4dbc17d0f5e2a060b9b) Thanks [@fforootd](https://github.com/fforootd)! - `plan` and `apply` now validate flow definitions against the same rules the
  server enforces — before any mutation. A flow missing an invariant (e.g. a
  login entry step without `user_not_found -> register` while `register` is a
  wired purpose) fails at plan time with the server's exact wording instead of
  half-applied after the schema already revised. Errors aggregate across flows
  (`--json` carries structured `details.issues`); product guidance surfaces as
  non-blocking `# warning:` lines in the plan. The validator ships as
  `@zitadel/config/validate`. Escape hatch: set `ZITADEL_SKIP_FLOW_VALIDATION`
  to skip the pre-flight if it ever disagrees with your server version.

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

- [#500](https://github.com/zitadel/nextgen/pull/500) [`69b6b6a`](https://github.com/zitadel/nextgen/commit/69b6b6a0fa934cbbd81deba46192b3b1346612a8) Thanks [@fforootd](https://github.com/fforootd)! - `zitadel setup` now asks "How should users sign in?" and scaffolds the
  matching schema+flow preset: `password-first` (today's default) or
  `passkey-first` (a one-tap passkey on the login entry step with an
  email → password fallback path, passkey-primary registration, and email
  kept required so the fallback always works). Non-interactive and scripted
  runs use `--preset`; the choice is recorded in `zitadel.json`. Presets are
  named bundles under `@zitadel/config` (the mechanism behind app-type
  selection, [#448](https://github.com/zitadel/nextgen/issues/448)) and are hygiene-tested: every bundle must pass the flow
  validator and resolve every text key in every builtin locale.
- Updated dependencies [[`e9593cd`](https://github.com/zitadel/nextgen/commit/e9593cd4f74f5ebc010150a2ed8a3ae03b7d5d87), [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19)]:
  - @zitadel/api@0.1.0-alpha.16

## 0.1.0-alpha.15

### Patch Changes

- [#485](https://github.com/zitadel/nextgen/pull/485) [`9e9ccb3`](https://github.com/zitadel/nextgen/commit/9e9ccb39997eda62a8eeb673fff4a46e9f2ddc0e) Thanks [@fforootd](https://github.com/fforootd)! - `apply` now re-pins flows to a freshly published schema revision in the same
  run: the CLI rewrites `user_schema` in every local flow file pinned to the
  superseded revision (lockfile-style, announced by `plan` and reported in the
  output) and the flow update carries the new id — editing a schema and using
  the new field in a flow no longer fails validation or needs a second apply.
  Interrupted runs recover via a `previousId` marker in `.zitadel/state.json`.

- [#482](https://github.com/zitadel/nextgen/pull/482) [`f52841d`](https://github.com/zitadel/nextgen/commit/f52841df9c1d5da857c2ff48d50a894c66fbcb5b) Thanks [@vitorbari](https://github.com/vitorbari)! - Improve the generated `.zitadel/schemas/README.md` guidance for editing user schemas and matching login flows.

- [#485](https://github.com/zitadel/nextgen/pull/485) [`9e9ccb3`](https://github.com/zitadel/nextgen/commit/9e9ccb39997eda62a8eeb673fff4a46e9f2ddc0e) Thanks [@fforootd](https://github.com/fforootd)! - Make `plan` diffs trustworthy and keep local config in lockstep with live
  state. `@zitadel/config/normalize` is the shared canonical-form normalizer
  (drops the server's empty `audience` echo and spelled-out `x-*` meta-schema
  property defaults); the sync engine hashes and diffs in normalized form
  (with a legacy-hash fallback so existing state files don't read as edits),
  and setup/apply write the server's canonical body back to the local file —
  reported in human and `--json` output — so a one-field edit renders as a
  one-field diff and applying can no longer silently strip live settings.
  The api-mock now mirrors the server's unconditional `audience` echo.

- [#485](https://github.com/zitadel/nextgen/pull/485) [`9e9ccb3`](https://github.com/zitadel/nextgen/commit/9e9ccb39997eda62a8eeb673fff4a46e9f2ddc0e) Thanks [@fforootd](https://github.com/fforootd)! - Surface the customize loop after setup: the "Zitadel is ready" next steps now
  point at the editable `.zitadel/schemas/` and `.zitadel/flows/` files and the
  `plan`/`apply` commands, and the scaffolded READMEs are restructured
  workflow-first (mental model → example → making changes → common changes).
- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.15

## 0.1.0-alpha.14

### Minor Changes

- [#341](https://github.com/zitadel/nextgen/pull/341) [`605abe1`](https://github.com/zitadel/nextgen/commit/605abe1f04a011c05bd4be2179556052eae6c007) Thanks [@fforootd](https://github.com/fforootd)! - Scaffold editable schema and flow config from shared local defaults, add project default seeding control, and seed sync state so plan is idempotent immediately after setup.

### Patch Changes

- Updated dependencies [[`605abe1`](https://github.com/zitadel/nextgen/commit/605abe1f04a011c05bd4be2179556052eae6c007)]:
  - @zitadel/api@0.1.0-alpha.14
