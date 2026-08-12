# @zitadel/cli

## 0.1.0-alpha.18

### Minor Changes

- [#711](https://github.com/zitadel/nextgen/pull/711) [`5208d86`](https://github.com/zitadel/nextgen/commit/5208d863015f78c9618317398ceda1e959c13296) Thanks [@fforootd](https://github.com/fforootd)! - The framework SDK packages (react, vue, angular, svelte, solid, qwik, nuxt) now re-export the `businessLocales` copy overlay from `@zitadel/components`, so an app that only declares its framework SDK as a direct dependency can wire the work-email wording without reaching into `@zitadel/components` (which strict package managers would not resolve). `zitadel setup --use-case business` uses this to wire the overlay into every framework's generated auth pages — previously only Next scaffolds got the business copy; the SPA scaffolds pass a plain `locales` prop to the wrapper components, and `doctor --fix` regenerates the same markup from the recorded use case.

- [#754](https://github.com/zitadel/nextgen/pull/754) [`a1d01cd`](https://github.com/zitadel/nextgen/commit/a1d01cd1f384515929216ae019658b30dae91504) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Add `zitadel claim`, which attaches a project to a team so it becomes permanent. The command mints a short-lived link with the project secret, opens it in a browser, and blocks until the developer finishes signing in there, then records `claimed_at` and `team_id` in `.zitadel/secret`.

  Nothing about the project changes: the issuer, users, passkeys, and applications keep working, and the project secret is not rotated. Running it again once the project belongs to a team is a clean `status: "skipped"` with `reason: "already-claimed"`, whether that is known locally or learned from the platform, so agents can retry safely. Links last 10 minutes; once one lapses the command exits `E_VALIDATION` and points at a fresh run.

  `--dry-run` stops before anything is minted and reports `status: "skipped"`, `reason: "dry-run"`. There is nothing to preview, because a claim is decided in a browser rather than by anything the CLI computes.

  The link is always printed before any browser opens, so headless machines, SSH sessions, and `--no-open` need no special handling. Where a browser can be launched, `BROWSER`, macOS, Windows, WSL, and the usual Linux openers (`xdg-open`, `gio open`, `x-www-browser`, `sensible-browser`, `gnome-open`, `kde-open`) are all handled. `--timeout <seconds>` stops waiting sooner than the link's own expiry.

- [#776](https://github.com/zitadel/nextgen/pull/776) [`48effc9`](https://github.com/zitadel/nextgen/commit/48effc9e728dbe11ce45efe6572fe5da48ee0465) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Report whether a project is attached to a team in `setup`, `status`, and `doctor`, so the temporary nature of a fresh project is visible without having to know `zitadel claim` exists.

  `setup` closes with an ownership line and points at `claim`, `status` carries `data.project.claim` (`detached`, or `attached` with the owning `team_id` and `claimed_at`), and `doctor` grows a `claim` check. All three read `claimed_at`/`team_id` from `.zitadel/secret`, which `zitadel claim` already writes, so nothing here costs a platform call and everything keeps working offline.

  A project with no team is a **warning**, never a failure: it works exactly like one with a team, so `doctor` still exits 0, and `--fix` deliberately does nothing because claiming needs a human in a browser. The messaging frames unattached projects as temporary without promising deletion, since nothing deletes them today.

  Nudges appear only for projects whose `server` in `zitadel.json` is the Zitadel cloud. Local and self-hosted projects have no team to attach to, so `zitadel setup --server local` stays quiet about it.

- [#685](https://github.com/zitadel/nextgen/pull/685) [`e80bfb3`](https://github.com/zitadel/nextgen/commit/e80bfb34d3e9d2332eb2424dc8537f42b48c3ad8) Thanks [@fforootd](https://github.com/fforootd)! - `doctor` now verifies the scaffolded app files. Setup records a scaffold manifest (per-file content hash and ownership class) in `.zitadel/state.json`; the new `managed-files` check fails when an infrastructure file (request boundary, `custom-elements.d.ts`) is missing, warns on a missing generated page, and classifies edited or user-adopted files without failing them. `doctor --fix` restores missing managed files and — across all checks, including the dependency repair — never replaces an existing scaffolded app file, edited or not; additive repairs (gitignore entries, env keys, the SDK dependency) stay idempotent. The check also verifies the managed config wirings (the Vite/Nuxt dev-proxy merges, Angular's `angular.json` proxy and auth routes) through the patchers' own idempotent transforms — a detached or missing wiring config fails, an unverifiable one warns, and `--fix` re-applies it. Boundary migrations converge safely: a pristine leftover `middleware.ts` from a Next 15→16 upgrade is swapped for `proxy.ts` by `--fix`, while an edited one becomes an explicit conflict instead of creating both. Apps scaffolded by older CLI versions are checked against template-derived expectations until `doctor --fix` materializes their manifest (`setup` skips initialized projects).

- [#713](https://github.com/zitadel/nextgen/pull/713) [`9eaa610`](https://github.com/zitadel/nextgen/commit/9eaa61022101b4af1fa8bac77864fee22486c2f7) Thanks [@fforootd](https://github.com/fforootd)! - The CLI now enforces its supported framework floors — Next.js 15 and newer, React 18 and newer. `setup` refuses a below-floor app before making any change, and `doctor` reports one the same way: both emit an explicit `E_UNSUPPORTED_PROJECT_SHAPE` error naming the floor together with an upgrade hint. Only version ranges that provably cannot resolve to a supported release are rejected — protocol specs (`file:`, `workspace:`), dist-tags (`latest`), and ranges that admit a supported version all pass. `@zitadel/sdk-next` now declares the matching peer range `next >=15`.

- [#686](https://github.com/zitadel/nextgen/pull/686) [`e375e18`](https://github.com/zitadel/nextgen/commit/e375e1811b9d03ceae8b517cf2230f52957e8a5c) Thanks [@fforootd](https://github.com/fforootd)! - The framework SDK wrappers now expose the widgets' surface contract: `ZitadelLogin` and `ZitadelSession` accept `variant` (`widget` | `page`) and `theme` (`light` | `dark` | `auto`), and `ZitadelLogout` accepts `theme`, across the React, Vue, Angular, Svelte, Qwik, and Solid wrappers. The `locales` prop additionally accepts partial dictionaries, so presets like `businessLocales` are directly assignable. Apps scaffolded by `zitadel setup` pin `variant="page"` on the generated `/profile` page's `<zitadel-session>` (keeping it full-page under the new widget-first default) and reference the SDK-shipped React JSX declarations instead of carrying a hand-maintained copy.

- [#717](https://github.com/zitadel/nextgen/pull/717) [`cb42772`](https://github.com/zitadel/nextgen/commit/cb427725b28a650739c5c86e72187f3df1529570) Thanks [@fforootd](https://github.com/fforootd)! - Give the embedding app a supported way to read session state for its own chrome (header navigation, account menus) — previously the widgets read `GET /sessions/me` internally but the host page had no documented path to the same answer and kept rendering signed-out CTAs beside a live session.
  - `@zitadel/sdk-next` ships a new `@zitadel/sdk-next/session` entry with `getSession()`: a client-side read of the same-origin `{proxyPath}/sessions/me` (the exact read `<zitadel-session>` performs). Works on any page — unlike server-side `auth()` it does not require the route to be covered by the middleware `matcher` — and returns the client-safe `ClientAuthResult` (`userId`/`email`/`name`, no token). 401, the backend's JSON 404, and anonymous sessions map to signed-out; other failures — including a framework's HTML 404 from a misrouted proxy — throw instead of silently rendering signed-out.
  - The client-safe auth shapes (`ClientSession`, `ClientAuthState`, `ClientAuthResult`) move to `@zitadel/sdk-core` as the single source; `@zitadel/sdk-nuxt` re-exports them unchanged, so its `useAuth()` and sdk-next's `getSession()` now return the identical shape.
  - CLI scaffold guidance (`AGENTS.md` managed section) and the generated profile pages now name each framework's session read: `getSession()` on Next, the auto-imported `useAuth()` composable on Nuxt, and the raw `/__nextgen/sessions/me` read for the SPA frameworks.

- [#750](https://github.com/zitadel/nextgen/pull/750) [`560ebf0`](https://github.com/zitadel/nextgen/commit/560ebf0b8a50bf378a4e011343f43ff3688a3efe) Thanks [@fforootd](https://github.com/fforootd)! - The setup wizard now asks how the login should look: keep the preselected
  built-in template (writes nothing), or pick one of the five starter designs
  (centered, split, split-right, hero, minimal) to eject it into
  `.zitadel/branding/` and publish it as branding revision 1 during setup.
  `--design` answers the question non-interactively, as before. The chosen
  design is reported in the summary box, the JSON envelope (`data.design`,
  `null` for built-in), and the setup retry hint, and setup's next actions
  now point at the branding workflow — edit/plan/apply when a design was
  ejected, `branding eject` when not.

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

- [#707](https://github.com/zitadel/nextgen/pull/707) [`53d46fe`](https://github.com/zitadel/nextgen/commit/53d46fe3df8f93184e05582f934ecfc26d282564) Thanks [@fforootd](https://github.com/fforootd)! - `zitadel setup --use-case business` now wires the SDK's `businessLocales` overlay into the generated Next login/register pages, restoring work-email wording on top of the widgets' neutral built-in copy (assigned via a ref so it holds on React 18, and `doctor --fix` regenerates the same markup from the recorded use case). The generated profile pages leave page chrome to the session card's `variant="page"` surface instead of hardcoding viewport height and background, every scaffolded page names the `variant="widget"` embedding alternative in a comment, and the scaffolded AGENTS.md guidance points at the widgets' variant/theme knobs and the SDK-shipped JSX types.

### Patch Changes

- [#719](https://github.com/zitadel/nextgen/pull/719) [`b37f23b`](https://github.com/zitadel/nextgen/commit/b37f23bc68cce7ba2ed0f0c2aac081de73f1c70d) Thanks [@fforootd](https://github.com/fforootd)! - Session-state reads now bypass caches and only canonical Zitadel 401/404 error
  responses are treated as signed out, including expired or superseded session
  cookies. The browser-only `getSession` helper and its options type now live on
  the dedicated `@zitadel/sdk-next/session` entry instead of the package root.
  Framework proxies attach the project secret only to the exact
  `POST /sessions/exchange` handoff operation, so browser-reachable public and
  management paths no longer receive an infrastructure-supplied operator
  credential. After upgrading the CLI, run `zitadel doctor --fix` to migrate the
  legacy managed Vite and Angular proxy hooks. Doctor warns when an unrecognized
  proxy may still over-forward the project secret; custom proxy implementations
  remain user-owned and must be reviewed manually.

- [#603](https://github.com/zitadel/nextgen/pull/603) [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c) Thanks [@fforootd](https://github.com/fforootd)! - Add the `hero` landing design, a mobile compact brand header for split-family designs, split layout knobs (`--zl-split-columns`, `--zl-split-align`, `--zl-split-brand-mobile`), and a warn-once console signal for missing text keys.

- [#547](https://github.com/zitadel/nextgen/pull/547) [`121e227`](https://github.com/zitadel/nextgen/commit/121e22776713f8972d2967f7b23c404c93f659c0) Thanks [@fforootd](https://github.com/fforootd)! - `stop` now reaps the local server's embedded Postgres, and `start` self-heals a
  Postgres orphaned by an earlier unclean exit. The server binary starts Postgres
  through `pg_ctl`, which daemonizes the postmaster into its own session — so the
  process-group signal `stop` sends never reached it, and a crash or SIGKILL could
  leave it running and holding the data-directory lock. The next `start` then
  failed with `E_NETWORK` ("exited before becoming healthy") and a `pg_ctl:
another server might be running` log. The CLI now terminates that postmaster by
  its `postmaster.pid` (SIGINT fast-shutdown, escalating to SIGKILL) on every stop
  and before every start, so `start → stop → start` is reliable again.

- [#681](https://github.com/zitadel/nextgen/pull/681) [`1348cca`](https://github.com/zitadel/nextgen/commit/1348ccacaf1ecee056c9a6c7b9b9543ad1e2fdc1) Thanks [@fforootd](https://github.com/fforootd)! - `zitadel setup --renderer` now only advertises implemented renderers: `--help` lists `react` and calls out the planned `web-component` renderer as not yet available instead of offering it as an equal option. Passing `--renderer web-component` explicitly now fails at flag parsing — before any remote project is created — rather than mid-setup.

- [#824](https://github.com/zitadel/nextgen/pull/824) [`77220eb`](https://github.com/zitadel/nextgen/commit/77220ebca4c81e78a1b43e103d3405f2acb5a10a) Thanks [@fforootd](https://github.com/fforootd)! - Scaffolded auth pages now derive their embedding posture from how setup met the app (ADR 044). Fresh scaffolds keep the widgets' full-page chrome; a pre-existing Next or Nuxt app gets `variant="widget"` cards with `theme="auto"` in a layout-neutral wrapper, so the login no longer paints token-colored chrome underneath the host app's own header and theme. Nuxt setup also stops writing `app.vue`/`pages/index.vue` into pre-existing apps — the shell and homepage stay user-owned, mirroring Next. The chosen posture is recorded in the scaffold manifest and `doctor --fix` restores it; manifests without a record restore full-page. A new `dependency-version` doctor check warns (with the exact install command) when an exactly-pinned `@zitadel/*` dependency trails the CLI's own train, so a newer CLI's guidance can't silently reference SDK entry points the app's pinned SDK does not ship yet.

- [#688](https://github.com/zitadel/nextgen/pull/688) [`612c2e7`](https://github.com/zitadel/nextgen/commit/612c2e7e8343f6c12e6d7354374b3446c1b5c182) Thanks [@fforootd](https://github.com/fforootd)! - `setup` no longer reorders your `package.json`: the dependency splice preserves the file's key order, indentation, line endings, and trailing newline (only the touched dependency map is name-sorted, as package managers write it); the Angular `dev`-script merge behaves the same. Setup's file reporting is also cleaned up — `files_written` now lists deduplicated file paths only (directories and double-counted env merges are gone), and a new `data.files` carries one typed row per artifact (`{path, kind, action}`) so scripts can tell what setup created versus merged into.

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

- Updated dependencies [[`a964309`](https://github.com/zitadel/nextgen/commit/a9643097df1fbbf1ca339ed8b7271e4271616b0d), [`35d287f`](https://github.com/zitadel/nextgen/commit/35d287ff5bb092bcdee4861fd2ec268efbec6b2d), [`8dadbd8`](https://github.com/zitadel/nextgen/commit/8dadbd8cdeabc7c289c7bef8ccce3d779a43e7c4), [`7120ce3`](https://github.com/zitadel/nextgen/commit/7120ce328eb9c63bbc6ff0bad0465c7f1f49e602), [`04e77a7`](https://github.com/zitadel/nextgen/commit/04e77a712edac7f9b486a6014134ddfc7cb71190), [`ff66683`](https://github.com/zitadel/nextgen/commit/ff66683eeb0daa3a12e7d11fed01076ac8c2ba58), [`0142d94`](https://github.com/zitadel/nextgen/commit/0142d9406d0a641858d2731fcabe2561a57edf27), [`c704fea`](https://github.com/zitadel/nextgen/commit/c704fea9f7d5f9ac037190b9979f4a897d3cd770), [`2fdb22e`](https://github.com/zitadel/nextgen/commit/2fdb22e76f3ca512864321a729860668d2370b70), [`4fdaf16`](https://github.com/zitadel/nextgen/commit/4fdaf16c6d0ea354477665049b428f34b055ef8e), [`f7b2049`](https://github.com/zitadel/nextgen/commit/f7b2049eee601843e58dc96606690e6d49863fc4), [`b403dc4`](https://github.com/zitadel/nextgen/commit/b403dc48830d54c96f650a0e8584a13cd4abf6f3), [`7ea32f8`](https://github.com/zitadel/nextgen/commit/7ea32f82b582e37944535b537940f035bdda8cde), [`de02bfc`](https://github.com/zitadel/nextgen/commit/de02bfcce196d07aedd44388895c6e8bd98a87a5), [`2c63b47`](https://github.com/zitadel/nextgen/commit/2c63b47c025e1255683b0b8cd2c48a3e25f79b3a), [`2019602`](https://github.com/zitadel/nextgen/commit/20196023ec4ccd9cfe55c205537f85ddb487fe8f), [`6652e57`](https://github.com/zitadel/nextgen/commit/6652e57b6ede15d921de029fff6aea2a7315875d), [`1f66979`](https://github.com/zitadel/nextgen/commit/1f6697956ee81a5a28812905283ddb94f649250f), [`ca91e8f`](https://github.com/zitadel/nextgen/commit/ca91e8f0368a59f9b96df2f380ec708b3b678f6c), [`63490d7`](https://github.com/zitadel/nextgen/commit/63490d715f92a1a1726b8a6c12c6afe7de52c19c), [`f720dbb`](https://github.com/zitadel/nextgen/commit/f720dbb5b2a8ea974bad87263bd3e1e0fd377eca), [`b37f23b`](https://github.com/zitadel/nextgen/commit/b37f23bc68cce7ba2ed0f0c2aac081de73f1c70d), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`14aacb5`](https://github.com/zitadel/nextgen/commit/14aacb59c16a6a4c30ebf905e98c2d21acaa5ef2), [`def4e92`](https://github.com/zitadel/nextgen/commit/def4e92e92e54fbe8bb149c5eb9e72c0c2da1e9c), [`d2bca36`](https://github.com/zitadel/nextgen/commit/d2bca36bdaa09168363e8e581cc4f0ef5db7eeb8), [`e0b8d3d`](https://github.com/zitadel/nextgen/commit/e0b8d3d66356f80d658198edccca3d6d77077c29), [`97470b2`](https://github.com/zitadel/nextgen/commit/97470b2d51fdf815463336ffe7999f864e510f13), [`e58a4c1`](https://github.com/zitadel/nextgen/commit/e58a4c1161d11d519d04cb944ab2875270ddc8c2), [`c0336d4`](https://github.com/zitadel/nextgen/commit/c0336d4dfe539f62a9bbbad35095236d2ba5c2f1), [`1d32433`](https://github.com/zitadel/nextgen/commit/1d324331491e672473352f71c4e4cec59450a4cf), [`77ceae3`](https://github.com/zitadel/nextgen/commit/77ceae3368cd5c0bb3ad691d31544b0453782b17), [`39e5a20`](https://github.com/zitadel/nextgen/commit/39e5a20bce36555f0269febd04acf4e5c0acf9e3), [`d419841`](https://github.com/zitadel/nextgen/commit/d4198416f65fc5ac7182a5ccf9cb247bf07b4922), [`de68ead`](https://github.com/zitadel/nextgen/commit/de68ead4bf02de17069185c46a71d1d7a98b1345), [`8197eea`](https://github.com/zitadel/nextgen/commit/8197eea30f65ac668554cb2caced367f3627bc36), [`a87a614`](https://github.com/zitadel/nextgen/commit/a87a614433c19ead251de28d5ebd3435aff9dcba), [`4b984af`](https://github.com/zitadel/nextgen/commit/4b984afbbde622b6f86d90ff327f4b21f9526785), [`417a378`](https://github.com/zitadel/nextgen/commit/417a3786aaa1d77c041fe679ca1fcdafc8ef6ce8), [`734ed68`](https://github.com/zitadel/nextgen/commit/734ed68ef444c9b932f561fbda4feb371336d06d), [`40c8537`](https://github.com/zitadel/nextgen/commit/40c8537efc12203fce05855b9536500a4a78621a), [`0f94093`](https://github.com/zitadel/nextgen/commit/0f94093d6f1909ce314c9c45d95703cefff6efd4), [`418457f`](https://github.com/zitadel/nextgen/commit/418457f7407c712f3ff02b30df014fbf12e03d23), [`658ce78`](https://github.com/zitadel/nextgen/commit/658ce78926b96240bcae583fee2e042283991b30), [`4b984af`](https://github.com/zitadel/nextgen/commit/4b984afbbde622b6f86d90ff327f4b21f9526785), [`6394228`](https://github.com/zitadel/nextgen/commit/6394228f61426eed4bd28d0df781a98b42a9ac95), [`1395911`](https://github.com/zitadel/nextgen/commit/1395911519a40ceb4e06e8b68729376553d2768d), [`ff6fc16`](https://github.com/zitadel/nextgen/commit/ff6fc16df33a597ef68a6174f4ecd74a9cfcecca), [`fa907c2`](https://github.com/zitadel/nextgen/commit/fa907c2272b2b4d54974b0510240f6225b7fece6), [`b5b9b6e`](https://github.com/zitadel/nextgen/commit/b5b9b6eeaf3d09ccffc41812db4c339a1c1faf7b), [`034b966`](https://github.com/zitadel/nextgen/commit/034b9662fe3572a525fc0c2974512ec0cd906187), [`c39d501`](https://github.com/zitadel/nextgen/commit/c39d501ebb4ba36c8a6589985e9107a56fe6dce9), [`4f4a97e`](https://github.com/zitadel/nextgen/commit/4f4a97e568268ed3c9ba30dca97b3d31a2d2edb1), [`929d158`](https://github.com/zitadel/nextgen/commit/929d158371f9750410d255c631327ec042dfa9c0), [`ff0a47d`](https://github.com/zitadel/nextgen/commit/ff0a47d4cc676be93d563251468e43fad03e21b0), [`f61eeb0`](https://github.com/zitadel/nextgen/commit/f61eeb0705d9dc3f0bfc83c1fe365e34ac945a50), [`9cf915b`](https://github.com/zitadel/nextgen/commit/9cf915bb67579cdfbac4211df7634c59d38be738), [`d594f00`](https://github.com/zitadel/nextgen/commit/d594f00cd1b5acf8c002e9f034b3a7faca1d6555), [`1b80119`](https://github.com/zitadel/nextgen/commit/1b801198ab2a5355b6f6265a38799bb126764c39), [`929d158`](https://github.com/zitadel/nextgen/commit/929d158371f9750410d255c631327ec042dfa9c0), [`47bcb8f`](https://github.com/zitadel/nextgen/commit/47bcb8fa24473ad81bf56c9c890c7e0fd7f6b1f3), [`ef617c8`](https://github.com/zitadel/nextgen/commit/ef617c87f0cfbb9497afb385d3d573d2fa3d4fa2), [`ef617c8`](https://github.com/zitadel/nextgen/commit/ef617c87f0cfbb9497afb385d3d573d2fa3d4fa2), [`01361c3`](https://github.com/zitadel/nextgen/commit/01361c31d5cda5ab0e4d881c300da7567d22eb36), [`a40c7d1`](https://github.com/zitadel/nextgen/commit/a40c7d10f2a250ab044eb2de0967ec086c002e11), [`a40c7d1`](https://github.com/zitadel/nextgen/commit/a40c7d10f2a250ab044eb2de0967ec086c002e11), [`70ccb39`](https://github.com/zitadel/nextgen/commit/70ccb3921adcf2b7c58eccef894ddb0611fa59b8), [`0377731`](https://github.com/zitadel/nextgen/commit/0377731a788c42f99404fa73b5c2e5b710870da7), [`45ef2cc`](https://github.com/zitadel/nextgen/commit/45ef2ccd692cd592b01e8dad2bbbf95a67d9c8a0), [`85d9e67`](https://github.com/zitadel/nextgen/commit/85d9e6730bd749a685548e45fc3b1afe5a545dee), [`4c3a3ce`](https://github.com/zitadel/nextgen/commit/4c3a3ceccfbad8bebfb3c97fcf86de5dfa7d71e4), [`e313d92`](https://github.com/zitadel/nextgen/commit/e313d92ab8b289c1947273dbe1befc3551c6f8b3), [`3f86dcd`](https://github.com/zitadel/nextgen/commit/3f86dcdee48c5ed1a50529ccca93f97809549265), [`3f86dcd`](https://github.com/zitadel/nextgen/commit/3f86dcdee48c5ed1a50529ccca93f97809549265), [`09c753e`](https://github.com/zitadel/nextgen/commit/09c753eb59e0fa0cd70446a77202dc8207b1a1c1), [`fd31b20`](https://github.com/zitadel/nextgen/commit/fd31b20c79de2c1d14c42aa48fab6e856e848775), [`58696a0`](https://github.com/zitadel/nextgen/commit/58696a06cadcf118aaac866151bffed093016423), [`f2cec14`](https://github.com/zitadel/nextgen/commit/f2cec1417437c4f7d33dc4bd2281b802cfebe406), [`41a2de2`](https://github.com/zitadel/nextgen/commit/41a2de240cb446cd12b438a442a55e7b90287e80), [`286cf4a`](https://github.com/zitadel/nextgen/commit/286cf4a37746c6ac7ae70864e1106f18d5895991), [`2cf426e`](https://github.com/zitadel/nextgen/commit/2cf426e0bbe9d27059d748f16272bd1674408dc0), [`2975c4d`](https://github.com/zitadel/nextgen/commit/2975c4dabec68ac1a8569d6a34960de50dced1b8), [`5decdd7`](https://github.com/zitadel/nextgen/commit/5decdd7cfb05beca7994ed7202548dc4915e2a59), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c)]:
  - @zitadel/server@0.1.0-alpha.18
  - @zitadel/api@0.1.0-alpha.18
  - @zitadel/config@0.1.0-alpha.18

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

- [#543](https://github.com/zitadel/nextgen/pull/543) [`a0b39a1`](https://github.com/zitadel/nextgen/commit/a0b39a119408a6fa02e8e1e45ebd5dd14b96c01b) Thanks [@fforootd](https://github.com/fforootd)! - `plan --json` and `apply --json` now enumerate what they touch: a
  `data.changes` array with one `{kind, action, file, id?, previous_id?}`
  row per resource (action ∈ create/update/revision/delete). Plan rows
  preview the pending sync; apply rows report what happened, carrying the
  resulting platform ids (created ids, newly published revision ids), so
  agents can verify an edit did what they intended without re-applying.
  `apply` also gains `next_actions`/`next_commands` ("changes are live" +
  a versioned `plan` follow-up), and `schemas list` emits `created_at` in
  snake_case like every other envelope field. Counters and
  `files_updated` (local write-backs only) are unchanged.

- [#546](https://github.com/zitadel/nextgen/pull/546) [`c7fffef`](https://github.com/zitadel/nextgen/commit/c7fffefe1ee966ba7d8e34a18bfffbdd1cef5b8a) Thanks [@fforootd](https://github.com/fforootd)! - The interactive `setup` wizard now detects a running local Zitadel server the
  same way `start` and `doctor` do — via the runtime metadata written by
  `zitadel start` plus a `/healthz` probe on the default port — and preselects
  it in the server choice. Previously it scanned localhost ports for an OIDC
  discovery document the server does not serve, so it always reported "No local
  OIDC servers found" even with a healthy server running.
- Updated dependencies [[`79d4179`](https://github.com/zitadel/nextgen/commit/79d417924518c9ea272136db1f46aaf237497999), [`363482e`](https://github.com/zitadel/nextgen/commit/363482e27c88ac96c9a2b48c880e5caa5a4dcf65)]:
  - @zitadel/config@0.1.0-alpha.17
  - @zitadel/server@0.1.0-alpha.17
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

- [#497](https://github.com/zitadel/nextgen/pull/497) [`e9593cd`](https://github.com/zitadel/nextgen/commit/e9593cd4f74f5ebc010150a2ed8a3ae03b7d5d87) Thanks [@fforootd](https://github.com/fforootd)! - The passkey origin-allowlist rejection now names the allowed origins (e.g. `origin "http://127.0.0.1:3000" is not allowed for this project (allowed: http://localhost:3000)`), and `<zitadel-login>` surfaces the server's error message instead of a generic "returned 400". `@zitadel/api` exports the new `apiErrorMessage` helper for extracting the server error envelope from an `ApiError`.

- [#499](https://github.com/zitadel/nextgen/pull/499) [`1f2dcf6`](https://github.com/zitadel/nextgen/commit/1f2dcf647cc4d3b96275b4dbc17d0f5e2a060b9b) Thanks [@fforootd](https://github.com/fforootd)! - `plan` and `apply` now validate flow definitions against the same rules the
  server enforces — before any mutation. A flow missing an invariant (e.g. a
  login entry step without `user_not_found -> register` while `register` is a
  wired purpose) fails at plan time with the server's exact wording instead of
  half-applied after the schema already revised. Errors aggregate across flows
  (`--json` carries structured `details.issues`); product guidance surfaces as
  non-blocking `# warning:` lines in the plan. The validator ships as
  `@zitadel/config/validate`. Escape hatch: set `ZITADEL_SKIP_FLOW_VALIDATION`
  to skip the pre-flight if it ever disagrees with your server version.

- [#517](https://github.com/zitadel/nextgen/pull/517) [`8df6e7a`](https://github.com/zitadel/nextgen/commit/8df6e7a78bdb64c6d183728903904771038d8048) Thanks [@bastionstack](https://github.com/bastionstack)! - Remove the scaffold landing chooser ("Sign in, create an account, or open your profile") from every framework template. Fresh apps now redirect `/` to `/login`, setup next steps tell users to open `/login`, and Next.js auth pages no longer duplicate login/register links the widget already provides in-flow.

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

- [#524](https://github.com/zitadel/nextgen/pull/524) [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19) Thanks [@fforootd](https://github.com/fforootd)! - Setup failure guidance now reconstructs the full invocation: retry hints and
  `next_commands` carry `--preset`, `--renderer`, `--dev-port`, and
  `--non-interactive` alongside `--framework`, so following the printed command
  verbatim reproduces the requested scaffold instead of silently falling back to
  defaults. HTTP 404s map to the new `E_NOT_FOUND` error code with exit code 4
  (previously `E_VALIDATION`/exit 3 — update scripts that branch on it); a 404
  without the platform's error envelope also names the URL and asks whether the
  target is a Zitadel platform API. Passkey-first scaffolds add a note to
  AGENTS.md telling agents to verify the login loop via the email/password
  fallback or a CDP WebAuthn virtual authenticator, since automated browsers
  cannot complete passkey ceremonies.

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

- Updated dependencies [[`99395d1`](https://github.com/zitadel/nextgen/commit/99395d1ae038643bc664033281f4c9999e675975), [`9de949d`](https://github.com/zitadel/nextgen/commit/9de949d8e9376a63da5dccc23044cdf40264123f), [`e4d55d2`](https://github.com/zitadel/nextgen/commit/e4d55d22c64d28a19597718417af6447a66a5852), [`62a7982`](https://github.com/zitadel/nextgen/commit/62a79824e9574eaad1f478ef3b6d51badb4d1355), [`e4809a3`](https://github.com/zitadel/nextgen/commit/e4809a30d21ae9ca400e58d2ccbb7078c2d3efff), [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19), [`1eec59e`](https://github.com/zitadel/nextgen/commit/1eec59ee924cc2b12df11f5541d6a2eef8caa6c2), [`aeea830`](https://github.com/zitadel/nextgen/commit/aeea83071227816e2bf2d4ee6fb4597c70908459), [`e9593cd`](https://github.com/zitadel/nextgen/commit/e9593cd4f74f5ebc010150a2ed8a3ae03b7d5d87), [`1f2dcf6`](https://github.com/zitadel/nextgen/commit/1f2dcf647cc4d3b96275b4dbc17d0f5e2a060b9b), [`bdf2906`](https://github.com/zitadel/nextgen/commit/bdf29064ab783f1d14ea554f3512bf243e86d3b5), [`75b61e1`](https://github.com/zitadel/nextgen/commit/75b61e1f431bdd91f6e97dce4a87d51cd9d8a152), [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19), [`69b6b6a`](https://github.com/zitadel/nextgen/commit/69b6b6a0fa934cbbd81deba46192b3b1346612a8), [`85f5044`](https://github.com/zitadel/nextgen/commit/85f504491a10f0b41b99c123e91df1f41c2d5763)]:
  - @zitadel/server@0.1.0-alpha.16
  - @zitadel/config@0.1.0-alpha.16
  - @zitadel/api@0.1.0-alpha.16

## 0.1.0-alpha.15

### Patch Changes

- [#485](https://github.com/zitadel/nextgen/pull/485) [`9e9ccb3`](https://github.com/zitadel/nextgen/commit/9e9ccb39997eda62a8eeb673fff4a46e9f2ddc0e) Thanks [@fforootd](https://github.com/fforootd)! - `apply` now re-pins flows to a freshly published schema revision in the same
  run: the CLI rewrites `user_schema` in every local flow file pinned to the
  superseded revision (lockfile-style, announced by `plan` and reported in the
  output) and the flow update carries the new id — editing a schema and using
  the new field in a flow no longer fails validation or needs a second apply.
  Interrupted runs recover via a `previousId` marker in `.zitadel/state.json`.

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
- Updated dependencies [[`9e9ccb3`](https://github.com/zitadel/nextgen/commit/9e9ccb39997eda62a8eeb673fff4a46e9f2ddc0e), [`f52841d`](https://github.com/zitadel/nextgen/commit/f52841df9c1d5da857c2ff48d50a894c66fbcb5b), [`9e9ccb3`](https://github.com/zitadel/nextgen/commit/9e9ccb39997eda62a8eeb673fff4a46e9f2ddc0e), [`6e4a11a`](https://github.com/zitadel/nextgen/commit/6e4a11a7cd07587a51362d751fcc0320b00a4301), [`9e9ccb3`](https://github.com/zitadel/nextgen/commit/9e9ccb39997eda62a8eeb673fff4a46e9f2ddc0e)]:
  - @zitadel/config@0.1.0-alpha.15
  - @zitadel/server@0.1.0-alpha.15
  - @zitadel/api@0.1.0-alpha.15

## 0.1.0-alpha.14

### Minor Changes

- [#341](https://github.com/zitadel/nextgen/pull/341) [`605abe1`](https://github.com/zitadel/nextgen/commit/605abe1f04a011c05bd4be2179556052eae6c007) Thanks [@fforootd](https://github.com/fforootd)! - Scaffold editable schema and flow config from shared local defaults, add project default seeding control, and seed sync state so plan is idempotent immediately after setup.

- [#443](https://github.com/zitadel/nextgen/pull/443) [`ea193dc`](https://github.com/zitadel/nextgen/commit/ea193dc0fabdf3c49fa9c3e3bae4cf242001d630) Thanks [@bastionstack](https://github.com/bastionstack)! - Add a post-sign-in `<zitadel-session>` "signed in as" card: a dedicated element exposed through every SPA SDK and re-exported from sdk-next. CLI scaffolds now render it as the post-sign-in `/profile` page (with a Logout action) across all frameworks. Identity is read from `GET /sessions/me`, preferring `name` then `email` then `user_id`.

  `<zitadel-logout>` now sources its identity from the same `getMySession` operation instead of the `__nextgen_display` cookie, so both signed-in surfaces work against the real backend. Both components route their `getMySession`/`revokeMySession` calls through the shared `api-client` wrappers that enforce `credentials: "include"`.

### Patch Changes

- [#469](https://github.com/zitadel/nextgen/pull/469) [`f55a293`](https://github.com/zitadel/nextgen/commit/f55a2932610ba92315d7174704ca24b940d8d7a6) Thanks [@fforootd](https://github.com/fforootd)! - Route published CLI telemetry to the production Mixpanel project during npm publish.

- [#436](https://github.com/zitadel/nextgen/pull/436) [`13ef6b6`](https://github.com/zitadel/nextgen/commit/13ef6b6b59dde33358c72a93d81be4d0af9458ee) Thanks [@fforootd](https://github.com/fforootd)! - Map CLI telemetry events to Mixpanel's event country property so country appears correctly in analytics.

- [#474](https://github.com/zitadel/nextgen/pull/474) [`ec0a33c`](https://github.com/zitadel/nextgen/commit/ec0a33cfb1ace9e845d5aea6f60c46529fa06f7b) Thanks [@fforootd](https://github.com/fforootd)! - Verify public npm provenance after repository publication.

- Updated dependencies [[`eedc8fe`](https://github.com/zitadel/nextgen/commit/eedc8fe94a850fb2c7173c0b782bcae9d30817a1), [`ddc0c13`](https://github.com/zitadel/nextgen/commit/ddc0c1323ac7eac7332344931fe7c077857f70dc), [`54dcc87`](https://github.com/zitadel/nextgen/commit/54dcc87084dd2d2b8314d08221354683bae64c6b), [`605abe1`](https://github.com/zitadel/nextgen/commit/605abe1f04a011c05bd4be2179556052eae6c007)]:
  - @zitadel/server@0.1.0-alpha.14
  - @zitadel/api@0.1.0-alpha.14
  - @zitadel/config@0.1.0-alpha.14

## 0.1.0-alpha.13

### Patch Changes

- [#411](https://github.com/zitadel/nextgen/pull/411) [`720e526`](https://github.com/zitadel/nextgen/commit/720e526f0f29181b1ae5824dee18cf57b10bea3f) Thanks [@vitorbari](https://github.com/vitorbari)! - Drop the `x-password` user-property annotation. The flow engine sources the password challenge from the reserved `x-auth-methods#password` field name combined with `x-auth-methods.password.enabled` at the schema root (introduced in [#400](https://github.com/zitadel/nextgen/issues/400)); `x-password` is no longer read by any code path. Removed from the `user-property.json` meta-schema and the CLI's generated `password` preset; comments and docs updated to match.

- Updated dependencies [[`720e526`](https://github.com/zitadel/nextgen/commit/720e526f0f29181b1ae5824dee18cf57b10bea3f), [`b574f3a`](https://github.com/zitadel/nextgen/commit/b574f3a6e6122439fadd6f971b73a61b8554f293)]:
  - @zitadel/server@0.1.0-alpha.13
  - @zitadel/api@0.1.0-alpha.13

## 0.1.0-alpha.12

### Minor Changes

- [#392](https://github.com/zitadel/nextgen/pull/392) [`292bfc9`](https://github.com/zitadel/nextgen/commit/292bfc97006c85bc3926e345cae0e9021e715062) Thanks [@mridang](https://github.com/mridang)! - Add opt-out anonymous usage telemetry. Disable with `--no-telemetry`,
  `DO_NOT_TRACK=1`, or `ZITADEL_TELEMETRY=0`.

### Patch Changes

- [#337](https://github.com/zitadel/nextgen/pull/337) [`237c3c7`](https://github.com/zitadel/nextgen/commit/237c3c73a319e74c1411e3b04a1bb1a0e9d91051) Thanks [@bastionstack](https://github.com/bastionstack)! - Scaffolded app pages now enforce the dark surface the Zitadel widgets are designed for (`color-scheme: dark`, `#0f0f11`), instead of following the OS light/dark setting — across every framework template (`next`, `react`, `vue`, `angular`, `nuxt`, `solid`, `svelte`, `qwik`). This fixes the inconsistency where the `<zitadel-logout>` avatar (and other non-widget chrome, e.g. the `/profile` view) rendered on a white background while `<zitadel-login>` enforced its own dark surface.

  Removed misleading field hints from the login component locales (`en`, `de`, `it`): the password "include a symbol and number" hint (only `minLength` is enforced server-side) and the `YYYY-MM-DD` date-of-birth hint (native `<input type="date">` localizes its own format and submits ISO). A dynamic, validation-rule-driven hint is tracked in [#251](https://github.com/zitadel/nextgen/issues/251).

- [#372](https://github.com/zitadel/nextgen/pull/372) [`fb07553`](https://github.com/zitadel/nextgen/commit/fb075538cad22d9b9a67729e1fa02f394964e9e1) Thanks [@mridang](https://github.com/mridang)! - Set the now-required `kind` on the default flow's step actions: submit actions use `submit`, the register/login routing actions use `navigate`. Without it, the generated flow fails validation against the updated flow-definition schema.

- [#354](https://github.com/zitadel/nextgen/pull/354) [`4060d9d`](https://github.com/zitadel/nextgen/commit/4060d9da0a214b58913000173657ef75e8be0843) Thanks [@mridang](https://github.com/mridang)! - Align the CLI flow-definition sync update with the PUT contract: send the `{ flow_definition }` body envelope and the required `project_id` query parameter so updates to existing flow definitions are accepted by the generated server.

- Updated dependencies [[`a2f6526`](https://github.com/zitadel/nextgen/commit/a2f65266e00ee461e8e7fb1dee35e5add30b7199), [`f6279a0`](https://github.com/zitadel/nextgen/commit/f6279a0bac51447533a4a33eb33479b792558783), [`9b05b82`](https://github.com/zitadel/nextgen/commit/9b05b82c3e7546ad3c4ebd4a025a991da499abf8), [`2b2cfd5`](https://github.com/zitadel/nextgen/commit/2b2cfd58f63d564c96fdc582c07e874297a5229c), [`e5150f3`](https://github.com/zitadel/nextgen/commit/e5150f30dfc2b24230fa698bb99baeceb2841d00), [`5d18103`](https://github.com/zitadel/nextgen/commit/5d18103e677d31a5b9b7c93ea164bef53b3e6e96)]:
  - @zitadel/api@0.1.0-alpha.12
  - @zitadel/server@0.1.0-alpha.12

## 0.1.0-alpha.11

### Patch Changes

- [#310](https://github.com/zitadel/nextgen/pull/310) [`050f5d7`](https://github.com/zitadel/nextgen/commit/050f5d7a39a2a9160346276203e8da82db137478) Thanks [@mridang](https://github.com/mridang)! - CLI scaffolds now write the project service-key secret to `.env.local` as `ZITADEL_PROJECT_SECRET`, and the React/Vue/Angular dev proxies plus the Next.js and Nuxt server middlewares send it as the bearer on every proxied request instead of synthesising `sk_<project_id>` from the public project id. The secret stays server-side: `.env.local` is gitignored, Vite only exposes `VITE_`-prefixed vars to the client, Next.js auto-loads `.env.local` into `process.env` server-side, and the Nuxt module reads `process.env.ZITADEL_PROJECT_SECRET` in its `setup()` and pushes it into Nuxt's server-only `runtimeConfig.nextgen.projectSecret` (overridable at deploy time via `NUXT_NEXTGEN_PROJECT_SECRET`).

  Also drops the unused `onExchangeResponse` hook from `NextgenMiddlewareOptions` (no callers anywhere; alpha so no external usage to break).

- Updated dependencies []:
  - @zitadel/server@0.1.0-alpha.11
  - @zitadel/api@0.1.0-alpha.11

## 0.1.0-alpha.10

### Patch Changes

- [#328](https://github.com/zitadel/nextgen/pull/328) [`acb5b54`](https://github.com/zitadel/nextgen/commit/acb5b549386efcc5ede005871b145c1cd0f9ac5e) Thanks [@fforootd](https://github.com/fforootd)! - Improve fresh-app CLI recovery guidance and align agent automation hook docs with the rendered login controls.

- Updated dependencies []:
  - @zitadel/server@0.1.0-alpha.10
  - @zitadel/api@0.1.0-alpha.10

## 0.1.0-alpha.9

### Patch Changes

- [#325](https://github.com/zitadel/nextgen/pull/325) [`ae99992`](https://github.com/zitadel/nextgen/commit/ae999926df674eb7ca777e0273789b8f58f83a19) Thanks [@fforootd](https://github.com/fforootd)! - Report local port conflicts clearly, sweep managed local runtime orphans with `stop --all`, and explain non-empty setup targets.

- Updated dependencies [[`ae99992`](https://github.com/zitadel/nextgen/commit/ae999926df674eb7ca777e0273789b8f58f83a19)]:
  - @zitadel/server@0.1.0-alpha.9
  - @zitadel/api@0.1.0-alpha.9

## 0.1.0-alpha.8

### Patch Changes

- Updated dependencies [[`0547b8c`](https://github.com/zitadel/nextgen/commit/0547b8c397b1016e199fa16f0b208a7115720806)]:
  - @zitadel/server@0.1.0-alpha.8
  - @zitadel/api@0.1.0-alpha.8

## 0.1.0-alpha.7

### Patch Changes

- Updated dependencies [[`0bacdf2`](https://github.com/zitadel/nextgen/commit/0bacdf23226a1e90c37f09b3cac245e1cf917091)]:
  - @zitadel/server@0.1.0-alpha.7
  - @zitadel/api@0.1.0-alpha.7

## 0.1.0-alpha.6

### Patch Changes

- [#270](https://github.com/zitadel/nextgen/pull/270) [`30b4b41`](https://github.com/zitadel/nextgen/commit/30b4b411a9c99fc61d991f739636f93d7bee5b1d) Thanks [@vitorbari](https://github.com/vitorbari)! - Step `fields` and `actions` are now ordered `[{ name, ... }]` arrays on the wire (ADR 021). Templates iterate them in authorial order; the orchestrator builds `fields_by_name` / `actions_by_name` views for keyed lookups. The private `@zitadel/api-mock` workspace follows the same wire shape for tests. `gates` stays a name-keyed object for now.

- [#303](https://github.com/zitadel/nextgen/pull/303) [`69e41b2`](https://github.com/zitadel/nextgen/commit/69e41b24275a5337b04b977dd3582f3f5c5c1461) Thanks [@fforootd](https://github.com/fforootd)! - Improve local bootstrap guidance for Docker prerequisites, generated auth pages, and agent browser proof.

- Updated dependencies [[`2cf813e`](https://github.com/zitadel/nextgen/commit/2cf813e62d2d76346536911e3e4ccfe390fb3583)]:
  - @zitadel/server@0.1.0-alpha.6
  - @zitadel/api@0.1.0-alpha.6

## 0.1.0-alpha.5

### Minor Changes

- [#257](https://github.com/zitadel/nextgen/pull/257) [`6f8dd2d`](https://github.com/zitadel/nextgen/commit/6f8dd2d612b06d1ca546a7c16c6fb5c6430de2c1) Thanks [@mridang](https://github.com/mridang)! - Add `setup --framework react|vue|angular|nuxt` support to the CLI. Each framework scaffolds its auth entry/pages and wires `/__nextgen/*` calls to the backend with a `sk_<project_id>` bearer attached: React and Vue get a dev proxy magicast-merged into the Vite config (`vite.config.*`) that reads the project id from `ZITADEL_PROJECT_ID`; Angular gets a `proxy.conf.cjs` wired into `angular.json` that reads it from `zitadel.json`; and Nuxt registers the `@zitadel/sdk-nuxt` module in the Nuxt config (`nuxt.config.*`), which adds the proxy via server middleware. A `--dev-port` flag sets the scaffolded dev-server port.

- [#299](https://github.com/zitadel/nextgen/pull/299) [`f77ca44`](https://github.com/zitadel/nextgen/commit/f77ca44e85565976d26de0b6444b7fc5b1616e8c) Thanks [@fforootd](https://github.com/fforootd)! - Make the generated Next.js auth app easier for agents and developers to prove end-to-end registration, logout, and login in a visible browser.

### Patch Changes

- [#295](https://github.com/zitadel/nextgen/pull/295) [`f02718f`](https://github.com/zitadel/nextgen/commit/f02718f0499042569e13c1c67ae4135b6e943518) Thanks [@fforootd](https://github.com/fforootd)! - Allow fresh app scaffolding after `zitadel start` creates local runtime ignore files, and load Nuxt runtime config through the Nuxt virtual imports module.

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.5

## 0.1.0-alpha.4

### Patch Changes

- [#279](https://github.com/zitadel/nextgen/pull/279) [`ce237ef`](https://github.com/zitadel/nextgen/commit/ce237ef355422c666769eef20df78bdc8ec0e0f9) Thanks [@fforootd](https://github.com/fforootd)! - Harden local setup guidance, Next 16 scaffolding, and login form automation.

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.4

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
