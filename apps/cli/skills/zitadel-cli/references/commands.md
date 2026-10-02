## Commands

The groups below mirror the ones `zitadel --help` prints.

### Project commands

- `setup` — create a Zitadel project and scaffold local auth (routes,
  middleware, `.zitadel/**`, env templates). Setup writes the versioned local
  default user schema and login flow into
  `.zitadel/schemas/default-human-user.json` and
  `.zitadel/flows/default-login.json`, uploads them through the schema and flow
  APIs, then seeds `.zitadel/state.json` so `plan` is immediately empty.
  Against a local server that hosts the platform project and has a local admin
  (the default `start` configuration), setup also attaches the project to the
  local admin's team: it writes `team_id` and `claimed_at` into
  `.zitadel/secret` and prints
  `Project owned by admin@zitadel.localhost (team ...)`, so a later `claim`
  returns `status: "skipped"` with `reason: "already-claimed"`. The step is
  best-effort. When the attempt fails on a platform-hosting runtime, setup
  warns and the normal claim nudge applies. When `start` opted out of the
  platform bootstrap there is no local admin and no claim surface, so setup
  skips the step silently, emits no nudge, and the project has no owning
  team. Agents
  must pass `--framework` when scaffolding into a fresh directory; interactive
  humans can omit it and choose from the prompt. Supported floors: Next.js 15+
  and React 18+ — `setup` and `doctor` fail with `E_UNSUPPORTED_PROJECT_SHAPE`
  below them instead of degrading silently (an unparseable version passes).
  Qwik requires Qwik 2 (`@qwik.dev/core`): the `@zitadel/sdk-qwik` widgets need
  it, so a Qwik 1 (`@builder.io/qwik`) app is not detected as Qwik, and a fresh
  `--framework qwik` scaffold is created on Qwik 2.
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
  in `zitadel.json`), `--skip-install`. Setup does not ask about or apply a
  login design: it writes no `.zitadel/branding/` files and publishes no
  branding revision (`branding eject` is the opt-in for that).
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
  link color `--zl-link`); the `suppress-header` attribute
  (wrapper prop `suppressHeader`) visually hides the widget's own heading
  block when the page already carries one, keeping it in the accessibility
  tree. Page layout around the widget (split screens, hero panes) is the
  app's own code, not a Zitadel template.
- `claim` — claim the project for a team to make it permanent. Mints a
  short-lived link, opens it in a browser, and blocks until the developer
  finishes signing in there, then records `claimed_at` and `team_id` in
  `.zitadel/secret`. Nothing about the project changes: the issuer, users,
  passkeys, and applications keep working, and the project secret is not
  rotated. Re-running once the project belongs to a team is a clean
  `status: "skipped"` with `reason: "already-claimed"`, so agents can retry
  safely. The link is always printed before any browser opens, so a headless
  machine, an SSH session, or `--no-open` needs no special handling — copy it
  and open it anywhere. Links last 10 minutes; once one lapses the command
  exits `E_VALIDATION` and points at a fresh run. Claiming itself is only
  possible within 14 days of project creation: past that the platform answers
  `410 proj.claim_window_expired`, the command exits `E_VALIDATION`, and a
  fresh link does **not** help — only a fresh `setup` yields a claimable
  project (the old one can no longer be claimed; it stays temporary and its
  data may be lost).
  `--dry-run` stops before
  anything is minted and reports `status: "skipped"`, `reason: "dry-run"` —
  there is nothing to preview, because a claim is decided in a browser.
  Flags: `--no-open` (print the link instead of launching a browser),
  `--timeout <seconds>` (stop waiting sooner than the link's own expiry).
  `setup`, `status`, and `doctor` report whether a team is attached, reading
  `claimed_at`/`team_id` from `.zitadel/secret` (no platform call). `status`
  carries `data.project.claim` as
  `{"kind": "detached", "claimable": true, "deadline": "2026-09-18T09:00:00.000Z"}`
  (`claimable` flips to `false` once the locally recorded creation time says
  the 14-day window has passed; the guidance then switches to reconciliation
  wording but the claim command stays in `next_commands`, because the local
  record can be stale and running `claim` answers authoritatively — an
  attached project skips cleanly. `deadline` is omitted when the creation
  time is unknown) or
  `{"kind": "attached", "team_id": "team_01H…", "claimed_at": "2026-08-01T09:00:00.000Z"}`,
  and `doctor` reports a
  `claim` check. A project with no team is only ever a **warning**, never a
  failure — it works exactly like one with a team, so `doctor` still exits 0
  and `--fix` deliberately does nothing (a claim needs a human in a browser).
  `status` and `doctor` stay silent about teams off the cloud: they answer
  offline and cannot know whether a local or self-hosted server hosts a
  platform to claim into. `setup` is online anyway, so against a local server
  it probes the runtime document and nudges only when the server hosts the
  platform plane (`platform.bootstrap_project`), where the claim can actually
  complete.
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
- `eject` (alias `uninstall`) — remove managed files and local Zitadel state;
  requires `--force` when non-interactive.

### Local server commands

- `start` — start the managed local Zitadel server and persist runtime metadata
  under `.zitadel/local/runtime.json`. The binary runtime defaults to SQLite
  under `.zitadel/local/nextgen-data/`. Runtime metadata reports the published
  server package version; the repository contributor wrapper reports the
  `dev+<short-commit>` source build it launched. That label names the revision
  the binary was built from, which after a Moon cache hit can be an earlier
  commit whose server sources are byte-identical. Use `--runtime docker` or
  `--image` for the Docker backend. The project's env files configure the
  local server: every `NEXTGEN_*` variable in `.env.local` and `.env` (the
  former wins; empty values are skipped) is handed to the runtime through its
  environment only (bare `--env NAME` on Docker), so no value reaches `argv`,
  logs, `runtime.json`, or `--json`. The address, data dir and public base the
  CLI sets itself always win. `data.runtime.env` and `runtime.json` carry
  `injected`, the list of names. A running runtime is not updated in place:
  after changing a value run `stop` then `start`. An unreadable env file fails
  `start` with `E_VALIDATION` before any runtime is stopped. `setup` writes a
  comment saying so at the top of the scaffolded `.env.example` and
  `.env.local`.
  The server boots with the platform project
  and a local admin, so the developer exists on their own server without
  signing up: the admin signs in as `admin@zitadel.localhost`, and a
  generated password is kept in `.zitadel/local/admin.json` (gitignored with
  the rest of `.zitadel/local/`) and never printed. `start` prints a one-time
  console sign-in link and reports it as `data.console.sign_in_url` with
  `data.console.signed_in_as`; if no link can be minted (for example a data
  directory from before the local admin existed), `data.console.error` and
  `data.console.hint` say why, `start` still succeeds, and `zitadel console`
  drops out of `next_commands`. Setting `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT=false`,
  in the shell or in `.env.local` / `.env`, opts out of both the platform project
  and the local admin, for harnesses that
  want a bare single-project server; `data.console` is then absent.
- `console` — print (and, interactively, open) a fresh one-time sign-in link
  for the local console as the local admin: `data.sign_in_url`,
  `data.signed_in_as`, `data.browser_opened`. Each link works once; run the
  command again for a new one. The console honours the link only when it is
  served from loopback, since the token signs in whoever opens it. Fails with `E_VALIDATION` when `start` never
  created a local admin in this directory. Flags: `--no-open`.
- `stop` — stop the managed runtime while preserving
  `.zitadel/local/nextgen-data`. Use `stop --all` to sweep all discovered
  host-wide CLI-managed local runtime processes, including healthy runtimes
  from other local projects; it does not kill arbitrary `/healthz` listeners.
- `status` — summarize the local runtime and project state.
  `data.server.runtime.env.injected` repeats the variable names recorded at
  the last `start` (empty for a runtime started before this field existed).
- `logs` — print managed runtime logs; `--follow` streams in human mode.
- `reset` — stop/remove the managed runtime and delete local runtime data;
  requires `--force` when non-interactive.

Alpha releases are fixed product package trains. `npx @zitadel/cli@alpha start`
uses the matching `@zitadel/server` package by default. `zitadel start --runtime
docker --image <ref>` remains the explicit image override for debugging.

### Configuration commands

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
- No command takes `--environment` (`-e`, `--env`). `plan`, `apply` and the
  resource commands work on the project's resources and never selected an
  environment; `variables` names its owner with `--project-level`. The flag
  returns when the platform's environments settle, and `deploy` (ADR 035) is
  what will put config onto one.
- `schemas list` — inspect the revision history of a user-schema, filtered by
  `--object-type` (e.g. `human-user`). Non-interactive/`--json` prints one row
  per revision (newest first); interactive adds a picker that fetches and
  pretty-prints the selected revision body.
- `sso enable --provider <name>` — add a social identity provider to a Project
  and wire it into sign-in. It reports the redirect URI to register with the
  vendor (`<issuer>/__nextgen/idp/callback`), then writes
  `.zitadel/idps/<slug>.json`, enables `sso` on the user schema (`--schema` when
  the Project has more than one), and adds the provider to every login flow that
  runs against that schema — the button on each step that can start a sign-in,
  plus a `register-sso` step for a new external identity and an `sso-conflict`
  step for an email that already has an account, the latter offering only the
  methods that schema enables. Idempotent: a provider already configured is
  reused, and a rerun that passes `--client-id` republishes it to the project
  variable, so a changed id takes effect rather than being ignored. Two
  matching connections stop the command without changing a file, as does a
  `--client-id` that disagrees with a *literal* one already in the connection
  file — a hand-written connection holding a real id rather than the scaffolded
  `${{ NAME }}` reference. The client secret is
  never a flag — it is prompted for, or read from stdin on a non-interactive
  run, as `variables set` does — and only its `${{ NAME }}` reference reaches
  the connection file. A step edited by hand is left alone and reported. `setup`
  asks during onboarding too, as a multi-select over the catalog, so a run can
  enable several providers at once; its `data.sso` is a **list**, one entry per
  provider, each carrying that provider's connection path and the publish
  outcome for its client id and secret. `--sso` and `--sso-client-id` name a
  single provider, because a scripted run pipes one secret on stdin — the rest
  are added with `sso enable`. `plan`/`apply` then publish the connection; **deleting** one is not
  supported yet (#1013), so a removed file fails `apply` with
  `E_NOT_IMPLEMENTED`.
- `branding eject` — take ownership of the login template: scaffold
  `.zitadel/branding/` (a `branding.json` descriptor plus the `login.liquid`
  template) from a shipped design, `--design centered|minimal` (the default card, or
  the same form without card chrome) or an interactive picker on a TTY. `plan`/`apply` then publish every edit as
  a new branding revision.
- `variables list|get|set|delete` — manage the variables and secrets a
  configuration document references as `${{ NAME }}`. Every command addresses
  one owner, and `--project-level` is the only one the CLI can name today, so it
  is **required**: a run without it fails with `E_VALIDATION`, on a terminal as
  in a script. The platform also keeps variables per environment, but the CLI
  cannot address those until the platform's environments settle; `--environment`
  returns then, and every command written today keeps its meaning because the
  owner was named rather than assumed. Owners do not inherit from one another —
  a value entered at the project level is **not** seen by an environment
  (ADR 062 §4). `set` takes its value from a prompt or from stdin and never from
  a flag, so a credential never reaches `argv`; `--secret` stores it encrypted,
  after which it can be replaced but never read back (`list` reports it as held,
  and `--json` omits the value key entirely). `set --as number|boolean` stores a
  JSON number or boolean instead of a string, so a whole-field `${{ NAME }}`
  reference resolves to that type; it is refused with `--secret`, and an integer
  too large to store exactly is refused rather than rounded. Output follows the
  resource commands: on a pipe, `list` prints tab-separated `name`/`value` rows
  (a secret's value is `(secret)`) and `get` prints the whole record as JSON,
  which carries no `value` key for a secret. There is no `pull` and no bulk
  import. `set` and `delete` honour `--dry-run` and make no change; `delete`
  needs `--force` when non-interactive.

