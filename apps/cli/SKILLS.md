---
name: zitadel-cli
description: >-
  Set up and manage Zitadel authentication in a local project with the
  agent-friendly `zitadel` CLI. Use when the user wants to add login,
  registration, or session handling, create a Zitadel project, scaffold auth
  for a Next.js, React, Vue, Angular, Nuxt, Solid, Svelte, or Qwik app, or plan and apply Zitadel
  config changes from repo state.
---

# Zitadel CLI

The `zitadel` CLI integrates Zitadel auth into an existing project and keeps the
local config (`zitadel.json` and `.zitadel/**`) as the source of truth. Every
command emits a JSON envelope, so you should drive it non-interactively and
parse the result rather than scraping human output.

## Invocation rules

- Always pass `--non-interactive --json`. The envelope is the contract.
- Add `--cwd <path>` when operating outside the current working directory.
- Never run interactive prompts; `--non-interactive` (and `--json`) disable them.
- The CLI sends anonymous usage telemetry by default. For automated/agent runs
  that should stay silent, disable it with `--no-telemetry` (per invocation) or
  `ZITADEL_TELEMETRY=0` / `DO_NOT_TRACK=1` (per environment); this also skips the
  small end-of-command network flush.
- See `README.md` (its commands section is generated from the CLI's own
  metadata) or run `zitadel <command> --help` for the full per-command flag list.

```sh
npx @zitadel/cli@alpha <command> --non-interactive --json
```

During the public alpha, bare `npx @zitadel/cli` is promoted to the same tested
alpha CLI so discovery works for first-time users. Prefer `@alpha` or an exact
`0.1.0-alpha.N` selector in agent scripts and bug reports for reproducibility.

## Reading the envelope

Each invocation prints one JSON object:

- `status`: `ok` | `skipped` | `error`.
- `cli_version`, `command`, `source`: always present.
- On success: `data` with the command-specific payload.
- On a no-op: `reason` (e.g. `no-framework-detected`, `orphaned-config`).
- On failure: `code` (e.g. `E_VALIDATION`, `E_NETWORK`, `E_NOT_FOUND`,
  `E_CONFLICT`) and `message`.
- `next_commands`: the suggested follow-ups. Prefer these over free-text hints.
- `plan` and `apply` also emit `data.changes`: one row per touched resource
  (`{kind, action, file, id?, previous_id?}`, action ∈ create/update/revision/
  delete). Plan rows preview; apply rows report, with the resulting platform
  ids. Use it to verify an edit did what you intended — `apply`'s
  `files_updated` lists only local write-backs, not platform changes.
- `setup` emits `data.files`: one typed row per scaffolded artifact
  (`{path, kind: file|dir, action: create|update}`), deduplicated. Use it to
  see what setup created versus merged into (your `package.json` is an
  `update`). `data.files_written` remains the flat list — deduplicated file
  paths only, covering both scaffolded and `.zitadel/` resource files.
- `setup` also emits `data.design`: the starter login design it ejected and
  published as branding revision 1, or `null` when the built-in template was
  kept (no `.zitadel/branding/` files exist in that case). Use it to verify
  the requested `--design` took effect without diffing the repo.
- `E_LOCAL_SERVER_NOT_RUNNING`: start the local runtime with
  `npx @zitadel/cli@alpha start`, then retry with `--server local`.
- `E_NOT_FOUND`: an HTTP 404 from the target server. With the platform's
  error envelope it names a missing resource (e.g. an unknown schema id);
  without one the endpoint itself is missing — the `--server` value likely
  points at something that is not a Zitadel platform API. Follow
  `next_commands` (usually `start` + retry with `--server local`).
- `E_PORT_IN_USE`: the requested local runtime port already has a listener.
  Stop that process, run `npx @zitadel/cli@alpha stop --all` for host-wide
  CLI-managed local runtimes, or choose another `start --port`.

Capture stdout and stderr separately when scripting. Some terminals and agent
UIs display both streams together, but the machine contract is one parseable
JSON object on stdout; installer, audit, and package-manager progress belongs
on stderr.

Exit codes mirror the error class (3 = validation, 4 = network or not-found,
5 = conflict, 1 = auth, 2 = not-implemented). An unknown command is handled by
the CLI's help layer, not the envelope.

## Commands

- `setup` — create a Zitadel project and scaffold local auth (routes,
  middleware, `.zitadel/**`, env templates). Setup writes the versioned local
  default user schema and login flow into
  `.zitadel/schemas/default-human-user.json` and
  `.zitadel/flows/default-login.json`, uploads them through the schema and flow
  APIs, then seeds `.zitadel/state.json` so `plan` is immediately empty. Agents
  must pass `--framework` when scaffolding into a fresh directory; interactive
  humans can omit it and choose from the prompt. Supported floors: Next.js 15+
  and React 18+ — `setup` and `doctor` fail with `E_UNSUPPORTED_PROJECT_SHAPE`
  below them instead of degrading silently (an unparseable version passes).
  Flags:
  `--framework next|react|vue|angular|nuxt|solid|svelte|qwik`, `--renderer
  react` (selects the Next.js auth-page renderer; accepted for any framework
  and recorded in `zitadel.json` branding, but only Next varies its generated
  templates by it; the planned `web-component` renderer is not yet available
  and is rejected if passed), `--dev-port` (dev-server port, also the issuer
  origin registered with Zitadel — use distinct ports to run several scaffolded
  apps side by side. The app must actually serve this port or the flow API
  rejects its origin on the first submit, so setup makes the port explicit in
  the app's own dev-server config: `server.port` + `strictPort` for Vite
  frameworks, `serve.options.port` for Angular, and — because `next dev` and
  `nuxt dev` take a port only from the command line — `--port` in the
  `package.json` `dev` script for Next and Nuxt. On a pre-existing app that
  means setup edits the `dev` script when it does not already name that port;
  a script already on it is left untouched), `--preset password-first|passkey-first` (the sign-in
  experience the scaffold starts from: `password-first` is the default —
  email + password with passkey optional during registration; `passkey-first`
  enters login on a one-tap passkey step with an email + password fallback;
  recorded in `zitadel.json`), `--use-case minimal|consumer|business` (which
  profile fields the scaffolded schema collects: `minimal` is the default —
  email only; `consumer` adds given and family name; `business` also adds a
  `companyName` attribute and overlays work-email copy on the generated auth
  pages via the SDK's `businessLocales`; asked before `--preset` and recorded
  in `zitadel.json`), `--design centered|split|split-right|hero|minimal`
  (starter login design: ejects the design's template into
  `.zitadel/branding/` and publishes it as branding revision 1 during setup;
  the interactive wizard asks this as its final question with the built-in
  template preselected — omit the flag in non-interactive runs to keep the
  built-in template and no branding files), `--skip-install`.
  On Next and Nuxt, the scaffolded auth/profile pages derive their embedding
  posture from the app: a fresh scaffold (setup created the skeleton) pins
  `variant="page"` full-page chrome, while a pre-existing app embeds
  `variant="widget"` cards with `theme="auto"` in a layout-neutral wrapper.
  `theme="auto"` follows the OS `prefers-color-scheme`, not the host app's
  own theme — edit the generated page to set `theme="light"` or
  `theme="dark"` when the app pins its scheme. Other frameworks always
  scaffold the page posture. The chosen posture is recorded in the scaffold
  manifest, `doctor --fix` restores managed pages in the recorded posture,
  and editing the generated page is the supported way to change presentation
  — there is no config knob.
  Widget-posture embedding levers: host-page CSS sets `--zl-*` design-token
  custom properties on the element to bridge the app's look through the
  widget's shadow DOM (fonts `--zl-font-family-heading`/`-sans`, radii
  `--zl-radius-*`, primary CTA `--zl-primary`/`--zl-primary-foreground`,
  link color `--zl-color-text-link`); the `suppress-header` attribute
  (wrapper prop `suppressHeader`) visually hides the widget's own heading
  block when the page already carries one, keeping it in the accessibility
  tree. Split-family designs collapse their brand pane by container width —
  at card width they show the compact brand mark (`logo_url`, else
  `hero_url`, from `.zitadel/branding/branding.json`; `hero` falls back to
  editable text), and setup warns when a widget-posture app picks `split`
  or `split-right`.
- `plan` — validate config and preview the sync diff without mutating anything.
- `apply` — validate and upload repo config to the platform.
- `plan` and `apply --dry-run` also emit `data.warnings`: non-blocking
  findings as `{path, rule, message}`, the same text the human plan prints as
  `# warning:` lines and `apply` prints through stderr. They never fail a run.
  Two families exist today: flow-definition rules (`warn/…`, mirrored from the
  server's validator) and branding asset reachability. `warn/asset-unreachable`
  and `warn/asset-content-type` come from a bounded HEAD probe of
  `logo_url` / `hero_url` — a URL that is well-formed but dead passes every
  gate and then renders as a 0×0 image with nothing in the console, so the
  probe is the only place it can be caught. It is advisory by design: the
  machine planning is not necessarily the machine that renders the login page.
  The probe only contacts public HTTPS destinations and re-checks every
  redirect; loopback/private/internal targets stay inconclusive instead of
  turning repo config into a network request from the planning host.
  Set `ZITADEL_SKIP_ASSET_PROBE` to turn it off (offline, air-gapped CI, or a
  CDN that only resolves from production) and `ZITADEL_ASSET_PROBE_TIMEOUT_MS`
  to retune the per-URL budget (default 2500).
- In the human-readable plan, a multi-line field (branding's inlined
  `liquid_template`) renders as `(<n> lines, sha256:…)` when it is created or
  unchanged, and as a changed-line diff when it moved — not as one escaped
  line. Read the file itself for full content.
- `schemas list` — inspect the revision history of a user-schema, filtered by
  `--object-type` (e.g. `human-user`). Non-interactive/`--json` prints one row
  per revision (newest first); interactive adds a picker that fetches and
  pretty-prints the selected revision body.
- `doctor` — verify generated app files and local state once `zitadel.json`
  exists. The `managed-files` check compares the scaffolded app files against
  the manifest setup recorded in `.zitadel/state.json`: a missing
  infrastructure file (the request boundary, `custom-elements.d.ts`) fails,
  a missing generated page warns, and files you edited (marker kept) or
  replaced (marker removed) pass as `edited`/`adopted`. It also verifies the
  managed config wirings (Vite/Nuxt proxy merges, Angular's `angular.json`
  proxy and auth routes) through the patchers' idempotent transforms — a
  detached or missing wiring config fails, an unverifiable one warns, and
  `--fix` re-applies it. The Next/Nuxt `dev` script is verified the same way,
  against the port recorded as the development issuer rather than the port the
  script names today: a script moved off that port reports as an unapplied
  config edit (a warning — a `dev` script is not the only way to choose a
  port), and `--fix` restores the registered one. Boundary migrations converge: a pristine leftover
  `middleware.ts` from a Next 15→16 upgrade is swapped for `proxy.ts`, while
  an edited one is reported as a conflict instead of creating both (Next
  rejects the pair). The default local
  runtime is the `@zitadel/server` npm binary; Docker checks apply only when
  using `--runtime docker` or `--image`. `--fix` restores missing managed
  files and never replaces an existing scaffolded app file; additive repairs
  (missing `.gitignore` entries, `.env.example` keys) still append to their
  targets, and the SDK dependency is re-added only when absent — an existing
  version pin is never rewritten. The `dependency-version` check warns when
  an exactly-pinned `@zitadel/*` dependency does not match the CLI's own
  version (the packages release as one train, and a floating
  `npx @zitadel/cli@alpha` can run ahead of the app's pins); ranges,
  dist-tags, and `file:`/`workspace:` specifiers express a deliberate choice
  and are not compared. The repair — an exact-pin install command for the
  project's detected package manager — is emitted in `data.next_commands`
  and quoted in the warning message.
- `claim` — attach the project to a team so it becomes permanent. Mints a
  short-lived link, opens it in a browser, and blocks until the developer
  finishes signing in there, then records `claimed_at` and `team_id` in
  `.zitadel/secret`. Nothing about the project changes: the issuer, users,
  passkeys, and applications keep working, and the project secret is not
  rotated. Re-running once the project belongs to a team is a clean
  `status: "skipped"` with `reason: "already-claimed"`, so agents can retry
  safely. The link is always printed before any browser opens, so a headless
  machine, an SSH session, or `--no-open` needs no special handling — copy it
  and open it anywhere. Links last 10 minutes; once one lapses the command
  exits `E_VALIDATION` and points at a fresh run. `--dry-run` stops before
  anything is minted and reports `status: "skipped"`, `reason: "dry-run"` —
  there is nothing to preview, because a claim is decided in a browser.
  Flags: `--no-open` (print the link instead of launching a browser),
  `--timeout <seconds>` (stop waiting sooner than the link's own expiry).
  `setup`, `status`, and `doctor` report whether a team is attached, reading
  `claimed_at`/`team_id` from `.zitadel/secret` (no platform call). `status`
  carries `data.project.claim` as `{"kind": "detached"}` or
  `{"kind": "attached", "team_id": "team_01H…", "claimed_at": "2026-08-01T09:00:00.000Z"}`,
  and `doctor` reports a
  `claim` check. A project with no team is only ever a **warning**, never a
  failure — it works exactly like one with a team, so `doctor` still exits 0
  and `--fix` deliberately does nothing (a claim needs a human in a browser).
  All three stay silent about teams when the project's `server` in
  `zitadel.json` is local or self-hosted, where there is nothing to attach.
- `status` — summarize the local runtime and project state.
- `eject` (alias `uninstall`) — remove managed files and local Zitadel state;
  requires `--force` when non-interactive.
- `start` — start the managed local Zitadel server and persist runtime metadata
  under `.zitadel/local/runtime.json`. The binary runtime defaults to SQLite
  under `.zitadel/local/nextgen-data/`. Use `--runtime docker` or `--image` for
  the Docker backend.
- `stop` — stop the managed runtime while preserving
  `.zitadel/local/nextgen-data`. Use `stop --all` to sweep all discovered
  host-wide CLI-managed local runtime processes, including healthy runtimes
  from other local projects; it does not kill arbitrary `/healthz` listeners.
- `logs` — print managed runtime logs; `--follow` streams in human mode.
- `reset` — stop/remove the managed runtime and delete local runtime data;
  requires `--force` when non-interactive.

Alpha releases are fixed product package trains. `npx @zitadel/cli@alpha start`
uses the matching `@zitadel/server` package by default. `zitadel start --runtime
docker --image <ref>` remains the explicit image override for debugging.

## Golden path

```sh
npx @zitadel/cli@alpha doctor --non-interactive --json
npx @zitadel/cli@alpha start --non-interactive --json
npx @zitadel/cli@alpha setup --framework next --server local --non-interactive --json
npx @zitadel/cli@alpha doctor --non-interactive --json
npx @zitadel/cli@alpha plan --non-interactive --json
npx @zitadel/cli@alpha apply --non-interactive --json
```

Exact alpha train invocation:

```sh
npx @zitadel/cli@0.1.0-alpha.N doctor --non-interactive --json
npx @zitadel/cli@0.1.0-alpha.N start --non-interactive --json
npx @zitadel/cli@0.1.0-alpha.N setup --framework next --server local --non-interactive --json
```

After `setup`, follow `data.next_commands` to start the app. Prove the generated
auth flow in a visible browser by registering a unique user, logging out, logging
back in with the same email/password, and ending on the signed-in profile page.
Do not treat a rendered login or registration form as completion.

### Driving the login UI

`<zitadel-login>` and `<zitadel-logout>` are Lit elements with open shadow
roots. The stable automation hooks live inside nested shadow roots, so a flat
`document.querySelector('[data-testid="zitadel-input-email"]')` will not find
the native control. Browser drivers with shadow-DOM-aware locators, such as
Playwright, can target the hooks directly. Generic DOM-eval drivers should
pierce shadow roots recursively:

```js
function deepQuery(sel, root = document) {
  const hit = root.querySelector(sel);
  if (hit) return hit;
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) {
      const result = deepQuery(sel, el.shadowRoot);
      if (result) return result;
    }
  }
  return null;
}
```

Use host hooks such as `zitadel-field-email`, `zitadel-field-password`, and
`zitadel-action-submit` when targeting the Lit atoms. Use native shadow-control
hooks such as `zitadel-input-email`, `zitadel-input-password`, and
`zitadel-action-submit-button` when filling or clicking the underlying input or
button. Hooks stay method-named even when the flow engine names a credential
field `x-auth-methods#<method>`; only the `name` attribute carries that raw
form key. Enter inside a field submits the step's primary action, but only for
key events that carry `key: "Enter"` — drivers whose synthesized key events
omit it (some CDP wrappers) should click `zitadel-action-submit` instead. For sign-out, open the user menu button if needed, then pierce to
`.signout-btn`; Playwright-style locators may use `zitadel-logout .signout-btn`.
The canonical component hook list lives in `packages/components/README.md`.

The checked-in automated regression path is `moon run workspace:journey`, which
exercises fresh-app setup plus registration, logout, and login across the
supported frameworks.

Repo config is authoritative: edit `zitadel.json` or files under `.zitadel/`,
then re-run `plan` and `apply`. Schema and flow files are synced from
`.zitadel/schemas/*.json` and `.zitadel/flows/*.json`. Login templates
(branding) are synced from `.zitadel/branding/`: a single `branding.json`
descriptor (layout, asset URLs) plus a sibling `login.liquid` LiquidJS
template referenced via `liquid_template_file`. Scaffold them with the
`branding eject` command (`--design centered|split|split-right|hero|minimal`,
interactive picker on a TTY) or at project creation with
`setup --design <name>`, which also publishes revision 1. Branding is
revisioned and immutable: every edit — including a `.liquid`-only edit —
plans as a `revise` and `apply` publishes a new revision; the login serves
the newest one. `plan` validates templates with the authoritative LiquidJS
validator (`E_VALIDATION` lists rule ids such as `no-script-tag` and
`mandatory-gates`; every template must keep a trailing
`{% mandatory_gates %}` tag). `font_url` is not writable yet; asset URLs
must be absolute `https://`. Keep exactly one descriptor in
`.zitadel/branding/` — extra `*.json` files there fail the scan.
Server-provisioned defaults remain a fallback for non-CLI project
creation, but CLI-created projects are authored from local files first. Flow create, read, list,
update, and delete are available, while the server enforces lifecycle rules
such as draft-only edits. Managed files carry a marker comment; `eject` removes only
files that still carry it, preserving anything the user replaced. For app-local
development, `--server local` resolves through `.zitadel/local/runtime.json` and
requires a healthy
`npx @zitadel/cli@alpha start` runtime. Runtime-only `.zitadel/local/**` state
does not block fresh same-directory scaffolding. `setup` installs dependencies
with the detected package manager by default; pass `--skip-install` when the
agent or host workflow will install dependencies separately.
