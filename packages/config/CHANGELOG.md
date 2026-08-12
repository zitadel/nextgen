# @zitadel/config

## 0.1.0-alpha.18

### Minor Changes

- [#783](https://github.com/zitadel/nextgen/pull/783) [`418457f`](https://github.com/zitadel/nextgen/commit/418457f7407c712f3ff02b30df014fbf12e03d23) Thanks [@vitorbari](https://github.com/vitorbari)! - A user schema property name must be a single attribute name and cannot contain
  a dot. The rule lives in the user-schema meta-schema and its OpenAPI mirror, so
  an editor validating against the shipped dialect flags it while authoring, and
  the server rejects it on create.

  Nested properties are validated as properties: each is an object describing one
  attribute, with its annotations checked. Generated clients type a user
  property's nested `properties` map as a map of user properties.

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

### Patch Changes

- [#259](https://github.com/zitadel/nextgen/pull/259) [`ff66683`](https://github.com/zitadel/nextgen/commit/ff66683eeb0daa3a12e7d11fed01076ac8c2ba58) Thanks [@peintnermax](https://github.com/peintnermax)! - `<zitadel-login>` maps the browser's back gesture to a step's `kind: "back"` action via a single re-armed History API sentinel entry (no URL changes). Back-navigation is gesture-only: the default template and all shipped branding designs render no visible control for the action, and the kind-based exclusion keeps it out of the generic secondary-button loop. Tenant templates can still render an explicit control from the wire action.

- [#603](https://github.com/zitadel/nextgen/pull/603) [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c) Thanks [@fforootd](https://github.com/fforootd)! - Add the `hero` landing design, a mobile compact brand header for split-family designs, split layout knobs (`--zl-split-columns`, `--zl-split-align`, `--zl-split-brand-mobile`), and a warn-once console signal for missing text keys.

- [#558](https://github.com/zitadel/nextgen/pull/558) [`d2bca36`](https://github.com/zitadel/nextgen/commit/d2bca36bdaa09168363e8e581cc4f0ef5db7eeb8) Thanks [@fforootd](https://github.com/fforootd)! - Strip trailing slashes from base URLs with an `endsWith` loop instead of a
  regex CodeQL flags as polynomial on uncontrolled input.

- [#660](https://github.com/zitadel/nextgen/pull/660) [`1395911`](https://github.com/zitadel/nextgen/commit/1395911519a40ceb4e06e8b68729376553d2768d) Thanks [@fforootd](https://github.com/fforootd)! - Update `liquidjs` to 10.27.2. 10.27.1 charges the `pop` filter against
  `memoryLimit` (CVE-2026-55575); 10.27.2 extends that accounting to the
  `join`, `json`, and `inspect` filters.

- [#551](https://github.com/zitadel/nextgen/pull/551) [`2cf426e`](https://github.com/zitadel/nextgen/commit/2cf426e0bbe9d27059d748f16272bd1674408dc0) Thanks [@vitorbari](https://github.com/vitorbari)! - `zitadel setup` now asks "Who will sign in to your app?" and scaffolds the
  matching schema fields: `minimal` (email only), `consumer` (email, given and
  family name), or `business` (adds a `companyName` attribute). `minimal` is the
  default, so the no-flag scaffold now collects **email only** — a deliberate
  slim-down from today's output: given/family name move to `consumer`/`business`,
  and `dateOfBirth` is no longer scaffolded by any use case. The default schema
  and login-flow templates (embedded as the server-side fallback for projects
  created without the CLI) are slimmed to the same email-only baseline, so the
  no-CLI default and the `minimal` use case now agree; the per-field bodies for
  `givenName`/`familyName`/`companyName` move into the config field catalog the
  CLI composes from. This is a second axis alongside the sign-in
  preset ([#448](https://github.com/zitadel/nextgen/issues/448)): the use case owns
  the schema field set, the sign-in preset owns the flow, and the login flow's
  register step is derived from the chosen fields instead of a hard-coded list —
  so the two compose instead of multiplying into a bundle per pair. The
  question is asked before the sign-in preset; non-interactive and scripted
  runs use `--use-case` (defaults to `minimal`, never blocks); the choice is
  recorded in `zitadel.json` for guidance/status only, never behavior. `business`
  is a field set only for now — `companyName` is a plain user attribute with no
  org/team model behind it yet. Every (use case × sign-in preset) pair is
  hygiene-tested against the flow validator.
  The unused, divergent `buildUserSchema`/`fieldPreset` helpers are removed in
  favor of a single source of field defaults.

- [#603](https://github.com/zitadel/nextgen/pull/603) [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c) Thanks [@fforootd](https://github.com/fforootd)! - Flip `<zitadel-login>` to widget-first: the default `variant="widget"` is content-sized, transparent through every layer, injects no default font into the host document, and never steals focus on load — the embedding app owns the page. Dedicated login routes (hosted shell, scaffolded pages) opt into the previous full-page behavior with `variant="page"`. Split-family responsive chrome now keys off the widget's own width via container queries (baseline 2023 browsers), the hero design ships neutral placeholder copy instead of fabricated claims, and split tenants with only a `hero_url` keep a compact banner fallback on narrow widths.

- Updated dependencies [[`7120ce3`](https://github.com/zitadel/nextgen/commit/7120ce328eb9c63bbc6ff0bad0465c7f1f49e602), [`7ea32f8`](https://github.com/zitadel/nextgen/commit/7ea32f82b582e37944535b537940f035bdda8cde), [`2c63b47`](https://github.com/zitadel/nextgen/commit/2c63b47c025e1255683b0b8cd2c48a3e25f79b3a), [`1f66979`](https://github.com/zitadel/nextgen/commit/1f6697956ee81a5a28812905283ddb94f649250f), [`d2bca36`](https://github.com/zitadel/nextgen/commit/d2bca36bdaa09168363e8e581cc4f0ef5db7eeb8), [`e0b8d3d`](https://github.com/zitadel/nextgen/commit/e0b8d3d66356f80d658198edccca3d6d77077c29), [`97470b2`](https://github.com/zitadel/nextgen/commit/97470b2d51fdf815463336ffe7999f864e510f13), [`e58a4c1`](https://github.com/zitadel/nextgen/commit/e58a4c1161d11d519d04cb944ab2875270ddc8c2), [`4b984af`](https://github.com/zitadel/nextgen/commit/4b984afbbde622b6f86d90ff327f4b21f9526785), [`40c8537`](https://github.com/zitadel/nextgen/commit/40c8537efc12203fce05855b9536500a4a78621a), [`f2cec14`](https://github.com/zitadel/nextgen/commit/f2cec1417437c4f7d33dc4bd2281b802cfebe406), [`41a2de2`](https://github.com/zitadel/nextgen/commit/41a2de240cb446cd12b438a442a55e7b90287e80), [`2975c4d`](https://github.com/zitadel/nextgen/commit/2975c4dabec68ac1a8569d6a34960de50dced1b8)]:
  - @zitadel/api@0.1.0-alpha.18

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
