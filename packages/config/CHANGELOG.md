# @zitadel/config

## 0.1.0-alpha.19

### Minor Changes

- [#804](https://github.com/zitadel/nextgen/pull/804) [`4e04e5f`](https://github.com/zitadel/nextgen/commit/4e04e5fb2a9585669b75d2b188b0966bfb23f4e7) Thanks [@vitorbari](https://github.com/vitorbari)! - `zitadel plan` understands nested user-schema properties. A step naming a leaf
  by its dotted path validates locally the way the server validates it, an
  object- or array-typed property is reported as not collectable, and a required
  object counts as covered when a step collects one of its leaves. Collecting into
  an optional object brings its own `required` list into force, since the object
  only exists in the document because one of its leaves was collected. A property
  declaring `properties` or `items` without a `type` keyword is an object or an
  array, and is reported the same way as one that spells its type out — including
  when its `type` is the nullable union `["null", "object"]`.

  Field names are matched against the schema's own properties only, so a step
  naming an inherited member such as `toString` is reported as not a property in
  the user schema instead of validating clean.

- [#901](https://github.com/zitadel/nextgen/pull/901) [`433f81c`](https://github.com/zitadel/nextgen/commit/433f81cffc3e3e8499c555aa45b2a45aa557916f) Thanks [@vitorbari](https://github.com/vitorbari)! - User schemas can now declare `x-audit: true` on a property, allowlisting that
  attribute's value for audit event payloads. Payloads stay deny-by-default:
  without it, an attribute contributes its key but never its value.

  `x-verify`, `x-editable`, `x-sensitive` and `x-mfa` are no longer part of the
  dialect. Nothing read them. A schema that still carries one keeps validating,
  since a property accepts annotations the dialect does not name, but they are no
  longer documented or offered by editor completion.

### Patch Changes

- [#874](https://github.com/zitadel/nextgen/pull/874) [`c2888bd`](https://github.com/zitadel/nextgen/commit/c2888bdfd3c2a21fefd76a9b7fa80507d97cd88b) Thanks [@fforootd](https://github.com/fforootd)! - Branding asset URLs (`logo_url`, `hero_url`) may now use plain `http://` with canonical loopback hosts (`localhost`, dotted-decimal `127.0.0.0/8`, `[::1]`) so local development can serve login assets straight from the app's own dev server. The login component preserves those URLs only when it also runs on a loopback HTTP page; public pages and every other URL field remain HTTPS-only. The CLI plan, server save, editor, and component gates now enforce the same syntax and explain the carve-out when rejecting a URL.

- [#886](https://github.com/zitadel/nextgen/pull/886) [`61a0eee`](https://github.com/zitadel/nextgen/commit/61a0eee0abb310a834d94b72a74f351035021be8) Thanks [@fforootd](https://github.com/fforootd)! - A branding asset URL that is well-formed but unreachable no longer fails
  silently. `logo_url` / `hero_url` cleared every gate — the CLI's shape check
  and the server's save gate — published a revision, and then rendered as a 0×0
  `<img>`: no plan output, no apply output, no console error.

  Three changes close that hole:
  - `plan` and `apply` probe each asset URL (HEAD, 2.5s budget, in parallel) and
    emit a non-blocking warning when it is unreachable, returns a non-2xx
    status, or answers with something that is not an image. Advisory by design —
    the machine planning is not necessarily the machine rendering the login
    page — so it never fails a run. Set `ZITADEL_SKIP_ASSET_PROBE` to turn it
    off (offline, air-gapped CI, a CDN that only resolves from production) and
    `ZITADEL_ASSET_PROBE_TIMEOUT_MS` to retune the per-URL budget. Only public
    HTTPS destinations are contacted and redirects are re-validated;
    loopback/private/internal targets remain inconclusive rather than becoming
    network requests from the machine running the plan.
  - The login UI hides an asset that fails to load and restores either the split
    designs' decorative placeholder or the shipped design's authored no-logo
    content, so a broken asset degrades to the same result as no asset instead
    of a blank pane or missing compact brand. Templates could not do this
    themselves: they are DOMPurify-sanitised and inline `onerror` is stripped.
  - Branding revisions can now carry plan warnings at all; previously only
    create/update actions could, and branding is revisioned.

  Two readability fixes ride along. A branding `plan` no longer dumps the whole
  inlined Liquid template as one escaped line: an unchanged multi-line field
  renders as `(<n> lines, sha256:…)` and a changed one as a real line diff. And
  the branding dialect file scaffolded into `.zitadel/meta/` now spells its
  command mentions the way the generated app can run them
  (`npx @zitadel/cli@<version> apply`), matching the READMEs — the bare
  `zitadel apply` in the editor tooltip named a command that does not exist
  there.

- [#872](https://github.com/zitadel/nextgen/pull/872) [`79f5ce1`](https://github.com/zitadel/nextgen/commit/79f5ce1db6b36baab85944a667072f1936880704) Thanks [@fforootd](https://github.com/fforootd)! - Scaffolded `.zitadel/**` READMEs now show runnable `npx @zitadel/cli@<version> …` commands instead of the bare `zitadel` command, which does not exist inside a generated app. The branding dialect now explains that `layout` is the degrade preset (`centered`/`split`), not the design name — switch designs with `branding eject --design`. The branding README shows exactly where `logo_url`/`hero_url` go (and that custom fonts aren't configurable there yet), and the setup summary surfaces the `.zitadel/` customization entry points (user schema, login flow, login template) and pairs the chosen design's wizard label with its slug (e.g. "Split (reversed)" → `split-right`) so you can confirm the selection applied.

- [#856](https://github.com/zitadel/nextgen/pull/856) [`b17b2c9`](https://github.com/zitadel/nextgen/commit/b17b2c9fb3fae00f99a1864d37f3b51142ea4344) Thanks [@fforootd](https://github.com/fforootd)! - The package documentation now matches what the packages actually do. The Next and Nuxt guides drop the removed `api-base` attribute in favor of `configureZitadel()` and the `project` property; the Nuxt guide documents the Nuxt module (what `zitadel setup` wires) with its real options and the `useAuth()` / `useZitadelProject()` composables, alongside the hand-rolled middleware path with its full option set. `@zitadel/sdk-core` and `@zitadel/api` gain real documentation of their entry points, `@zitadel/config` gains a package README, and the SPA guides document the `ZitadelSession` card and point local no-proxy experiments at the local runtime's actual default port (8080). The flow-editing guide copied into `.zitadel/flows/` no longer suggests cross-flow `switch`/`pivot` transitions, which the runtime does not execute yet, and API examples use the real prefixed ID format (`proj_…`, `team_…`) instead of a retired naming scheme.

- [#822](https://github.com/zitadel/nextgen/pull/822) [`41f6a0a`](https://github.com/zitadel/nextgen/commit/41f6a0a7c60e28a9adecfa9d72b964a305f7ba3d) Thanks [@vitorbari](https://github.com/vitorbari)! - Drop `position` from `x-auth-methods` entries; `enabled` is now the only key. The
  user schema declares which authentication methods a user type supports.
  Presentation concerns such as the order methods are offered in belong to the flow
  engine, which takes them from the order of a step's actions in the flow
  definition.

  An auth-method entry now sets `additionalProperties: false`, matching the
  enclosing `x-auth-methods` object, which already rejects unknown method keys. A
  schema that still carries `position` fails validation instead of being accepted
  with the field ignored.

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

- [#784](https://github.com/zitadel/nextgen/pull/784) [`9ef7096`](https://github.com/zitadel/nextgen/commit/9ef709667f1a6f7bd5126491bf4039a34a43a792) Thanks [@vitorbari](https://github.com/vitorbari)! - Schema normalization descends into nested `properties` when comparing local
  config against the platform. Spelling out a property default (`x-editable: true`,
  `x-sensitive: false`, `x-mfa: false`), applying, then removing it is a no-op —
  but on a nested property the comparison could not tell, so `plan` reported a
  change on every run and `apply` republished a revision each time.

  State hashes are computed over the normalized form, so a schema that spells out
  a default on a nested property hashes differently than it did before. The first
  `plan` after upgrading reports a revision for that schema with an empty field
  diff, and `apply` publishes it and re-pins the flows that reference it. It
  happens once — the new hash is stored and every later run is a skip. Schemas
  without a spelled-out nested default are unaffected.

- [#873](https://github.com/zitadel/nextgen/pull/873) [`37e9cb9`](https://github.com/zitadel/nextgen/commit/37e9cb903943d34eebadfb44457872892f296823) Thanks [@fforootd](https://github.com/fforootd)! - Split-family login designs now look intentional out of the box. The brand pane renders a token-gradient placeholder panel until `branding.json` names a `logo_url`/`hero_url`, so a fresh `split`/`split-right` eject reads as a split layout instead of a lonely off-centre card. The "Secured with Zitadel" attribution now aligns under the form column in split-family designs (it previously centred across both panes) and recentres when the layout collapses to a single column on narrow containers.

- Updated dependencies [[`b17b2c9`](https://github.com/zitadel/nextgen/commit/b17b2c9fb3fae00f99a1864d37f3b51142ea4344), [`fc3d154`](https://github.com/zitadel/nextgen/commit/fc3d154f2fabb722c6f94633fd6c10bc60d0a657), [`e26f376`](https://github.com/zitadel/nextgen/commit/e26f37617f5d3a3f92f00c07aad89a98ee9d754f)]:
  - @zitadel/api@0.1.0-alpha.19

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
