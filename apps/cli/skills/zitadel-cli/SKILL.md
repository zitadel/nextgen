---
name: zitadel-cli
description: >-
  Drive the `zitadel` CLI to set up and manage Zitadel authentication in a
  project. Use it whenever the work involves Zitadel or its CLI at all, even for
  a small request or one that follows earlier Zitadel work: adding login,
  sign-up or sessions; creating, listing or inspecting a Zitadel project or its
  credentials; scaffolding auth for a Next.js, Nuxt, SvelteKit, SolidStart, Qwik
  Router, TanStack Start, React, Vue, Angular, Solid, Svelte or Qwik app; or
  changing and deploying what lives in `.zitadel/` (user schema fields, sign-in
  methods such as passwords and passkeys, login flows, branding, policies,
  social sign-in). Load it before running a `zitadel` command or editing
  `.zitadel/` by hand: it holds the rules for deploying safely.
---

# Zitadel CLI

The `zitadel` CLI integrates Zitadel auth into an existing project and keeps the
local config (`zitadel.json` and `.zitadel/**`) as the source of truth. Every
command emits a JSON envelope, so you should drive it non-interactively and
parse the result rather than scraping human output.

This skill teaches how to *drive* the CLI — how to invoke it, its output modes,
and its envelope. It deliberately does **not** enumerate the commands. The CLI
is self-describing, and this skill and the installed CLI version move
independently: a user may install the skill once and upgrade the CLI later, so
any command or flag list hardcoded here would drift out of lockstep and mislead.
Ask the CLI for its current surface (see [Discovering commands](#discovering-commands))
and treat what it prints as authoritative over anything you remember.

## Installing and invoking

Run the CLI with `npx`, which fetches and caches it on demand — there is nothing
to install first:

```sh
npx @zitadel/cli@latest <command> --non-interactive --json
```

Use an exact version (`npx @zitadel/cli@0.1.0`) in agent scripts and bug
reports for reproducibility. The CLI is a preview: until 1.0.0 a minor version
can break, and its release note says so with **Breaking:**.

To move a project to the latest release, run `npx @zitadel/cli@latest upgrade`,
on the dist-tag so the newest release does the upgrading. It re-pins the
exactly-pinned `@zitadel/*` packages with the project's own package manager and
runs the new release's `doctor --fix`. It reports `data.packages`,
`data.breaking_changes` (read them first: `--dry-run` changes nothing) and
`data.refresh` (`done`, `issues`, `failed`, `planned` on a dry run, or `skipped`). A range or dist-tag is
listed in `data.left_alone` and stays as it is. `E_NETWORK` means the registry
did not say what the latest release is. `doctor` warns (`cli-version`) when a
newer CLI exists, asking the npm registry at most once a day (once an hour after a lookup that failed) and never on CI;
`ZITADEL_UPDATE_CHECK=0` turns that off, and a registry that does not answer
passes. Each of `doctor`'s `data.checks` has a `category`: `versions`,
`local_server`, `project`, `credentials`, `app_integration` or `environment`.
The CLI requires Node.js 24+. When `setup` creates a new app it first checks the running Node.js against the `engines.node` of the framework CLI it is about to run (`@angular/cli`, `nuxi`, `create-vite`, `create-next-app`). Only the Angular CLI refuses a Node it does not accept, and that range can be newer than 24.0: if `setup` refuses with `E_VALIDATION` naming the Node versions Angular accepts, switch to one of them and run it again. The Angular CLI checks each major on its own, so only 22.22.3+ on 22, 24.15.0+ on 24 and 26.x are accepted (23 and 25 run with a warning), and Node 27 or later is refused even though the published range reads `>=26.0.0`. For the other frameworks the CLI carries on, so `setup` adds a warning to the envelope's `warnings` and continues.

The app's framework must be at or above a minimum version: Next.js 15.2.3,
React 18, Vue 3.2, Nuxt 4, Angular 17, Solid 1.6, Svelte 5, Qwik 2.0.0-beta.45. Newer major
versions are not refused. `setup` and `doctor` refuse an app below its minimum,
by declared range or installed release, with `E_UNSUPPORTED_PROJECT_SHAPE`
(exit 3); `setup` refuses before it scaffolds or patches anything, while
`doctor --fix` can still repair unrelated files, so do not assume a floor error
left the project untouched. The message names the minimum and the hint says to
upgrade, so upgrade the app and rerun rather than retrying.

The CLI ships this skill and the other Zitadel skills. `skills add` puts the
ones of the version that runs it into the project's `.agents/skills/`, and into
`.claude/skills/` when Claude Code is installed or the project has a `.claude/`
folder, replacing older copies. After moving the app to a newer CLI, run it
with that version so the skills describe it. It talks to no server and asks
nothing; `data.skills` and `data.directories` say what it added where.

## Using the CLI

- **Drive it non-interactively.** Always pass `--non-interactive --json` (short:
  `-n`). The JSON object on stdout is the machine contract — parse it rather than
  scraping human output. `--non-interactive` also disables every prompt, so a
  command that would otherwise ask for an answer fails fast with `E_VALIDATION`
  naming the flag to pass instead of blocking. Supply each answer as a flag; run
  the command's `--help` to see which flags exist and which are required. A
  destructive change is the exception: it fails with `E_CONFIRMATION_REQUIRED`,
  whose flag only the user may agree to (next rule).
- **Ask the user before `--force` on anything destructive.** A command that
  deletes, revokes or rolls back (`user delete`, `variable rm`, `origin rm`,
  `deployment rollback`, `reset`, `eject`, a destructive `api` call) asks a
  person first. Non-interactive and without `--force`, it fails with
  `E_CONFIRMATION_REQUIRED` and changes nothing; `next_commands` holds the
  same command with `--force`, except for `api`, whose body may hold a secret
  or come from a pipe: rerun that call yourself, with its `-F` fields or
  `--input`, and add `--force`. Only the user can agree to that: unless they
  already asked for this exact change, put `details.question` to them and run
  the retry only once they say yes. `doctor --fix` reports a repair that
  waited for such a yes in `warnings`.
- **Commit `.zitadel/` before you `deploy`.** A release records the commit it
  was built from, and records it as approximate when the tree has uncommitted
  changes, so the next deploy cannot diff and the next session, which remembers
  nothing of yours, cannot tell your work from someone else's. After editing,
  run `git add .zitadel && git commit -m "<why>" -- .zitadel`, then `deploy -m "<why>"`.
  Skip the commit only when `git status` shows nothing under `.zitadel/`.
- **Output modes.** `--json` is the agent contract and is unaffected by the
  terminal — color and width never apply to it, so you do **not** need
  `--no-color` or other cosmetic flags when you parse JSON; don't sprinkle them
  on every call. Human mode adapts to the terminal: a TTY gets aligned tables,
  while a piped or redirected run (or `--plain`) gets one tab-separated record
  per line and nothing else. If you ever read human output, set `NO_COLOR=1`
  once in the environment rather than repeating `--no-color` per command.
- **Don't truncate `--json` with `head`/`tail`.** The envelope is one bounded
  object; slicing it with `head -c`/`head -n` yields invalid JSON and silently
  drops records or fields, so you end up reasoning from partial data. It is
  finite — read it whole, or narrow it *at the source*: use a `list` verb's
  `filter_fields` and pagination to fetch fewer records, or pipe to `jq` to pull
  just what you need (e.g. `… resources --json | jq '.data.items[].topic'`).
  `jq` may not be installed; `node -e` always is, so fall back to it rather
  than giving up on a check.
  `--help` output is bounded too — read it in full rather than `head`-ing it, or
  you will miss flags further down.
- **Working directory.** Add `--cwd <path>` when operating outside the current
  working directory. A relative `--env-file` path is still read from the
  current directory, not from `--cwd` (`--cwd app --env-file app/.env.ci`):
  Node reads `--env-file` itself before the CLI starts and exits 9 with
  `node: <path>: not found`, and no envelope, when the file is not there.
- **Server and project.** A command that talks to a project reads
  `ZITADEL_URL`, `ZITADEL_PROJECT_ID` and `ZITADEL_PROJECT_SECRET`, each from the
  first source that has it: `--server` (the URL only), `--env-file <path>`, the
  process environment, `.env.<env>.local`, `.env.local`, `.env.<env>`, `.env`,
  then `.zitadel/secret`. Only the default `development` environment reads
  `.env.local` and `.zitadel/secret` (setup's project); `--env-file` reads that
  file and the process environment only.
  `<env>` is `--env`, else `ZITADEL_ENV`, else a hosting platform's own signal
  (`VERCEL_ENV`, or Netlify's `CONTEXT` inside a Netlify build), else
  `development`. A missing value fails with `E_VALIDATION` naming the variable
  and the files it looked in; there is no cloud default outside `setup`, and
  the server is never read from `zitadel.json`. `zitadel env` shows what resolved and where
  each value came from; `zitadel env add <name>` binds another environment to a
  project. The project it creates has never had a release, so the environment
  refuses sign-in until something is deployed to it: run the
  `deploy` the result's `next_commands` names, against the file it wrote
  (`--env-file .env.<name>.local`). A person at a terminal is asked whether to
  deploy there and then; your runs never are, so they never deploy — run that
  `deploy` yourself. `data.deployment` carries the `release_id`,
  `content_hash`, `deployment_id` and `origins` when a person accepted, and is
  null otherwise — a failed deploy is a warning, never a failed `env add`.
  `ZITADEL_URL` and `--server` are the server's origin: the API lives under
  `/api/v1` there, which the CLI adds (and drops from a URL that already ends
  in it).
- **Project credentials are not an OAuth client.** The project id and project
  secret are how the app and the CLI prove they belong to the project. They are
  **not** an OAuth or OIDC client id and secret: the CLI manages no OIDC
  application, and a project `setup` made has none. When asked whether the
  project has a client id or secret, answer **no**, say it has a project id and
  project secret instead, and name where they live. The only `client_id` and
  `client_secret` fields the CLI knows belong to an external sign-in provider's
  connection (`idp`, `auth-method sso`), which exists only once someone adds
  one.
- **Origins.** `zitadel origin add <url> --kind primary|preview`, `origin list`
  and `origin rm <url>` manage the URLs a project serves: a `primary` origin is
  where the app is served, a `preview` pattern (it may hold a `*`) is where
  pull-request builds run. They need the project secret, not the preview token.
  An empty list admits no origin except a loopback origin; `origin rm` asks
  first and needs `--force` when non-interactive. Removing a preview pattern
  leaves its live previews served until they expire. A caller with no `Origin`,
  and the server's own origin when the project does not list it, run the
  newest primary deployment. Any other origin runs only what is deployed to
  it: a primary origin added since the last `deploy` answers `rel.not_deployed`
  until the next one, and so does a loopback origin the project does not list,
  until it is added with `--kind primary` and deployed to.
  `deploy` lands only on primary origins and fails with `E_VALIDATION` without
  one; its `next_commands` name the step that gives the project one. A
  deployment freezes its origins: a primary origin added later serves nothing
  until the next `deploy`, also after a `deployment rollback`, and one removed
  stops being served at once. `setup`
  0.1.0 registered the app's URL (`ZITADEL_ISSUER`) as a `preview` origin,
  which `origin add --kind primary` refuses with `E_CONFLICT`: `doctor` warns
  (`issuer-origin`) and `doctor --fix` makes it primary, which asks first;
  non-interactive, pass `--force` too, or `warnings` says the repair waited.
  The repair deploys the newest primary release to it when there is one;
  otherwise `warnings` says to `deploy`.
- **Telemetry.** The CLI sends anonymous usage telemetry by default, and
  agent-driven runs are exactly the ones worth learning from — leave it on.
  Don't add `--no-telemetry` to commands. An opt-out exists for users who need
  it (`ZITADEL_TELEMETRY=0`, or the standard `DO_NOT_TRACK`, in their
  environment), but that is the user's environment choice, not a flag to attach
  to every call.
- **Flag conventions.** Flags follow what a model already expects from curl, ssh
  and wget: `--help`/`-h` (also `zitadel api help`), `--version`, `-v`/`--verbose`,
  kebab-case long flags, both `--flag value` and `--flag=value`, and
  `--no-telemetry`-style negation. `-h` anywhere before `--` asks for help, even
  as a flag's value.
  Two deliberate deviations worth knowing: `-n` is `--non-interactive` (not
  `--dry-run`, which is long-only), and machine output is `--json` (not
  `--output json`). `api` takes `-X` for the method, as curl does, and `-F` for
  a typed field, as `gh api` and `vercel api` do (not curl's form field).
- **Writing a resource's body.** A `create` or `update` takes every field of
  its body as a flag, nested ones too: a nested field's flag is its dot path
  joined with `-` (`oidc.client_id` is `--oidc-client-id`), a list is a
  repeated flag, a boolean takes `--no-<flag>` for `false`, and an open record
  (`attributes`) takes repeated `key=value` entries. `--set <path>=<value>`
  (or `<path>:=<json>` for JSON) reaches any field by its dot path, and
  `--data` / `--file` take the whole document. They combine: the document
  first, then the field flags, then each `--set`, with objects merging key by
  key. `resources --json` lists each write's fields with their dot path
  (`name`), `flag` (`null` when only `--set` reaches it), `kind` and
  `required`; `--dry-run --json` returns the body that would be sent. For a
  deeply nested body, writing the document and passing it with `--file -` is
  often simplest. An `update` body holding a `null` removes what it names
  (a user attribute, a project's own password hash) without asking first.
  `user create` and `user update` refuse an attribute that fails its schema's `format` (`email`, `uri`, `uuid`, `date`, `date-time` and the other standard names). `user update` validates the whole merged user, so a stored value that fails must be corrected in the same request.
- **Calling an operation no command covers.** `zitadel api <operation>` calls
  any operation of the API with the server, project and project secret every
  project command resolves (`--server`, `--env`, `--env-file`, the `.env`
  files, `.zitadel/secret`). One that needs the secret fails with
  `E_VALIDATION` when no `ZITADEL_URL` resolves; one that needs none runs
  against the cloud where nothing names a server. One
  that deletes, revokes or rolls back asks first and needs `--force` when
  non-interactive, as the command that covers it does. An update is not
  asked about, even one whose `null` removes what it names.
  Name it by its `operationId` (`queryUsers`, as the API reference and
  `@zitadel/api` spell it) or by its path as the spec has it (`/users/query`,
  which the server serves at `/api/v1/users/query`; a path copied with the
  prefix works too, and `-X` picks the method where a path has several). Path parameters follow as arguments, in
  path order; a `project_id` left out is the project's own. `-F name=value`
  (or `name:=json`) sets a query parameter when the operation declares one by
  that name, else a dot path into the body, typed by the operation's schema;
  a list parameter takes one `-F` per value. `--input <path>` or `--input -`
  takes the whole body, under the `-F` fields. `--paginate` follows
  `next_page_token` to the last page. `--dry-run` sends nothing and returns
  the request. An operation only an end user's session or the login flow's
  cookie authenticates is refused with `E_VALIDATION`. Prefer a resource
  command where one exists: `api ls --json` names it in each operation's
  `command`.
- **Never put secrets on the command line.** A property whose name reads as a
  credential (`password`, `client_secret`, `api_key`, …) is refused anywhere on
  argv when it holds free-form text — as a field flag, a `--set` or
  `--attributes` entry, and inside an inline `--data` body alike, since argv is
  visible to other processes and kept in shell history. Send such bodies with
  `--file <path>` or `--file -` (stdin), which never pass through argv. A
  `${{ NAME }}` reference to a project variable is not a secret and may stay on
  argv (a connection's `client_secret` takes nothing else); write it in single
  quotes, since inside double quotes the shell reads `${` as its own expansion.
- **Streams.** Capture stdout and stderr separately when scripting, into files
  outside the app directory: `setup` scaffolds a new app only into an empty
  directory. The machine contract is one parseable JSON object on stdout;
  installer, audit, and package-manager progress belongs on stderr.

## Discovering commands

The CLI ships its own command list and per-command flags, always correct for the
installed version. **Do not guess a command name.** Before running any command you
are not certain of, look it up first and use the exact name the CLI prints:
command and resource names and the exact verb are whatever the CLI shows, never
what you would assume. A resource's noun is singular (`user list`,
`policy get`, `flow-definition list`); `branding` has no other form. The
plural runs the same command (`users list`), but nothing lists it, and every
output names the singular. A wrong guess costs a failed call and a round of
recovery; one cheap lookup up front avoids it. `zitadel --help` lists each
family of commands (`user`, `release`) as one row, so it stays short;
`zitadel commands` is the flat list of every command, verbs included, and
`zitadel <family> --help` lists one family's verbs. Treat the CLI's own output as authoritative over anything you remember:

```sh
npx @zitadel/cli@latest --help               # every command family, grouped by purpose
npx @zitadel/cli@latest commands             # flat list of all commands
npx @zitadel/cli@latest <command> --help     # a command's flags, which are required, and examples
npx @zitadel/cli@latest resources --json     # the resource surface in one call (see below); contacts no server
npx @zitadel/cli@latest api ls --json        # every API operation, its parameters, body and paging; contacts no server (`--plain` for tab-separated rows)
```

`--help` groups the commands by what you are doing: getting started, local
development, users and teams, authentication, configuration and releases, and
diagnostics and utilities. A family such as `user` is one row, and
`zitadel user --help` lists its verbs. Read the groups from `--help` rather than
from memory, since they change as the CLI gains commands.

Use `zitadel --help` to find *which* family or command to run, and
`zitadel commands` for the exact verb. Use `resources --json` when
you need a resource's *fields*: it reports the whole runtime-resource surface at
once — every resource, its verbs, each verb's `create_fields` / `update_fields`
(flag name, kind, `required`, any closed value set), its `filter_fields` /
`sort_fields`, and the `delete_outcome` a destructive verb returns — so prefer it
over reading `<resource> --help` one at a time. A `list` verb's envelope carries
`data.count`, the number of items it returned. A list returns one page unless
you pass `--all`, so a "how many …?" question is one `list --all --json` call:
read the count, do not page and tally.

To find a user by their identifier, the value a user carries as `identifier`:
`user list --filter identifier=starts_with:<start> --json` matches its start,
ignoring case. Name the operation: `starts_with` is the only one, so a part from
the middle of an identifier (the domain of an email) finds nothing. The users
come back ordered by identifier, and `--sort` cannot be combined with the
filter. The property comes from the revision the user is on, so a user who signs
in through a flow on a newer revision that designates another property does not
match on that property. Only string identifiers match, not a number or a
boolean. Other attributes are not filterable.

To find the users still on an older revision of a schema, filter on the
schema's object type and exclude the newest revision's URL:
`user list --filter schema_object_type=equals:<type> --filter
schema=not_equals:<newest-url> --all --json`.

To find what happened to one user's account, whoever did it: `event list
--filter user_id=<user-id> --json` returns the user's sign-ins with the
passwords that were rejected, their sessions and credentials, and the changes
made to the user. Add `--filter category=auth` for the sign-ins alone.
`--filter actor_id=<user-id>` is the other question, what that user did. Only
events recorded by a server that has this filter carry `user_id`.

To find the API requests that failed: `event list --filter status_class=4xx
--filter status_class=5xx --json`, and add `--filter operation_id=<operation>`
(such as `createUser`) for one operation. Only requests recorded by a server
that has these filters match, so an older request is found by its
`request_id`, not by them.

## Reading the envelope

Each invocation prints one JSON object:

- `status`: `ok` | `skipped` | `error`.
- `cli_version`, `command`, `source`: always present.
- On success: `data` with the command-specific payload, and the headline the
  terminal draws as `data.title` (except `api`, whose `data` is the response
  body as it came).
- On a no-op: `reason` (e.g. `already-initialized`, `already-claimed`,
  `nothing-to-eject`) and the headline it draws as `data.title`. `skipped` means
  nothing was done because a person declined or there was nothing to do.
- A dry run (`--dry-run`) answers `ok` with `data.dry_run: true` and a headline
  ending in `(dry run)` as `data.title`, never `skipped`, and `next_commands` holds
  the real command to run.
- On failure: `code` (e.g. `E_VALIDATION`, `E_NETWORK`, `E_NOT_FOUND`,
  `E_CONFLICT`) and `message`, usually with a `hint`, and `details` when there
  is structured context.
- `next_commands`: the suggested follow-ups, inside `data` on success and at
  the top level on a no-op or failure. Prefer these over free-text hints. Each
  is runnable as written: it names flags by their long form (`--message`, not
  `-m`) and repeats the `--cwd`, `--env`, `--env-file` and `--server` the run was
  given (the environment ones only for a command that takes them), so following
  it acts on the same project. A retry or a dry run's real command keeps every
  flag the run was given except those that only say how it answers
  (`--json`, `--non-interactive`, `--no-color`, `--verbose`, `--debug`,
  `--no-telemetry`); add `--non-interactive --json` when you run one.
- A command named in a `hint`, a `warning` or a `next_actions` line is written
  the same way `next_commands` writes it — `npx @zitadel/cli@<version> …`,
  unquoted — so prose and follow-up never name the same command two ways.
- `warnings`: things that went wrong without stopping the command, such as a
  value that was not published. Always present on success (often empty), and
  present on a no-op or failure when there are any. Read them before you report
  success: a warning usually means a follow-up step is needed.
- A `list` verb emits `data: { items, count, next_page_token }`; when a page
  remains, `data.next_commands` carries the exact command for the next page.
- A filtered `event list` page can hold fewer items than `--limit`, or none,
  and still carry `next_page_token`: the server matches some filters over a
  bounded number of events per request. Follow the token, or pass `--all`,
  before you report that nothing matched.
- `deploy` emits `data.content_hash` (the release digest), `data.origins`
  (the origins it went live on) and `data.resources` (how many it pinned). A
  re-run on unchanged config returns the same digest. Use it to confirm what
  went live.
- When the server refuses a release, `deploy` fails with `E_VALIDATION` and
  the `hint` lists each refused resource as `<kind> <handle>: <reason>`, such
  as `schema human-user: …` or `flow default-login: …`. A connection's line
  ends with the fields it may not change or the endpoints it left out, as in
  `idp acme-sso: …: oidc.issuer`. Read the hint, not only `message`
  (`release: invalid`); the same entries are in
  `details.body.details.resources`.
- `deploy`, `deploy --dry-run` and `doctor` check each user schema against
  the meta-schema the server uses. On the schema's root or a property, a key
  JSON Schema does not define, such as `minimumLength`, or an `x-` key the
  meta-schema does not declare is refused as
  `<schema>: <path> <key> is not an allowed key`, with
  `. Did you mean minLength?` when a keyword is close. `deploy` fails with
  `E_VALIDATION` and lists these lines in `details.issues`; `doctor` fails
  its `schema` check with them in the check's `message`. Keys inside
  `items`, `$defs` or `oneOf`/`anyOf`/`allOf` are not checked.
- `deploy` warns that a password step cannot tell which user to challenge only
  when no identifier step comes before it. A step reached through a
  `user_already_exists` collision, such as `sso-conflict`, is exempt: the
  collision names the user.
- `deploy` and `deploy --dry-run` read the project's users and refuse when the
  config would lock existing users out: users of a
  schema who lack its `x-identifier` property while a step on the login path
  collects it (it cannot tell who signs in with a password, so it counts them
  all), users of a schema no flow uses any more, who cannot sign in at all
  (the warning counts those with an SSO link on top), or users whose only
  credential is a method the release disables on their schema, such as a
  passkey once passkeys are off. Each lockout is listed in `warnings`, and a
  non-interactive run fails with `E_CONFIRMATION_REQUIRED`; `--force` deploys
  anyway. Ask the user before re-running with `--force`: it is for users they
  will migrate, or a lockout they mean. It runs only when the diff finds
  schemas or flows changed, or cannot tell. When it could not finish (a request failed, the
  unserved-schema part was skipped,
  or the read limit was reached), `warnings` carries a note saying so, such as
  "Could not finish checking existing users"; that note means the check was
  incomplete, not that users are locked out, and it never stops the deploy.
- `preview` is `deploy` for a pull-request build: it deploys the release to the
  build's preview URLs (from the platform, or `--origin`) for `--ttl` and emits
  `data.previews` plus `data.release_env` (the `NEXT_PUBLIC_ZITADEL_RELEASE`
  line to pin). It uses `ZITADEL_PROJECT_SECRET` until the server accepts the narrower preview token (#1575), never the other credential, and
  outside a preview or development build it is a no-op — even with an explicit
  `--origin`, which selects targets but never authorizes a preview deploy. A CI
  build other than Vercel or Netlify must set `ZITADEL_ENV=preview`, or it is
  skipped too. `preview list` and `preview rm <url>` read and end live previews.
- `deploy` and `preview` record `-m` on the release and the deployment. Omitted,
  they use a GitHub pull request's title, Vercel's commit message, or a clean
  worktree's commit subject; with none, a non-interactive `deploy` fails. A
  blank `-m` is refused. A release keeps the message of
  the run that first built its content, usually the pull request's `preview`.
  `deployment rollback -m` records why on the rollback.
- `deployment get`, `deployment rollback`, `deployment create --release`,
  `release revoke` and the `user`, `session` and `release` commands that take
  an id refuse a value that is not that kind of id (surrounding whitespace is
  trimmed) before they ask or call the server, saying what one looks like and
  suggesting the list command. `claim --challenge-id` refuses a malformed
  challenge id the same way.
- `release revoke` on a release an origin still serves fails with `E_CONFLICT`.
  When the server names the origins that serve it, the `hint` names the first
  three with their kind (`primary` or `preview`) and the deployment that pins
  the release there, and counts the rest. `details` is `{ release_id, origins }`
  and `origins` lists every one as `{ origin, deployment_id, kind }`; the
  server's own `status`, `url` and `body` are not in it. `next_commands` lists
  what frees them: `deploy` and `deployment rollback` for primary origins (each
  only helps if the release it puts live is a different one), and
  `preview rm <url>` for the first three previews, which cannot be rolled back
  and also stop serving when they expire. Revoke again once none serves it.
  Without origins the CLI can read, the conflict is the plain one: no `hint`, no
  `next_commands`, and `details` holds the server's `status`, `url` and `body`.
- `deployment get <id>` emits the deployment as the API serves it; on a
  terminal it also shows the variables the deployment froze, secrets masked.
  Read them as JSON with `variable resolve <id>`.
- `variable resolve` reads the variables a deployment froze: the one live on the
  project (narrowed with `--origin` when several are live), or any deployment
  named by `variable resolve <deployment_id>`. A deployment id together with
  `--origin` is refused, since the id already says which deployment. Only the
  live form's envelope carries `data.origins`, the origins that deployment
  serves; a named read has none.
- `variable set` stores the value on the project, but a sign-in keeps using the
  variables the last `deploy` froze, so the change applies after the next
  `deploy`. The envelope's `data.next_actions` says so and `data.next_commands`
  holds `deploy --message '<what changed>'`. With `--preview` it points to
  `preview --origin '<preview-url>' --message '<what changed>'` instead, since a primary
  `deploy` leaves the preview value unapplied; a pull-request build that sets its
  own preview URL can drop `--origin`. In an environment other than
  `preview` or `development`, where `preview` skips, no command is suggested; nor in a
  CI build that names no environment, where it says to pass `--env preview`.
  A secret written without `--preview` clears the name's preview value; set it again
  with `variable set <name> --secret --preview`.
- `deployment rollback` emits `data.release_id` (the release live again),
  `data.origins` (the origins that deployment froze) and `data.pointers`, the
  `{kind, handle, revision_id}` revisions that release pins; the `schema` one
  is what new registrations use. It restores the origins that deployment froze:
  `data.dropped_origins` are listed origins it leaves out, which refuse sign-in
  until the next `deploy`; `data.restored_origins` are listed origins the live
  deployment left out, which serve the release again; and
  `data.unserved_origins` are origins it names that the project no longer
  lists. All three are absent when that check failed, and a warning says so.
  Users keep their schema revision and attributes: a rollback does not migrate
  them back. Without `data.pointers`, a warning says the release could not be
  read.
- `deploy --dry-run` and `deploy` emit `data.diff`, the git diff the terminal
  shows, against the live release's commit (`diff.against`): `diff.files` holds
  one `{path, status, previous_path?, patch}` per changed file (`status` is
  `added`, `modified`, `deleted`, `renamed` or `copied`; `patch` is its unified
  diff), including rapid same-size edits and untracked configuration files.
  It covers `schemas/`, `flows/`, `branding/` and `idps/` under `.zitadel/`,
  the `*.json` files at the top of `.zitadel/policies/` but not their
  `*.test.json` test files, and any file a branding descriptor's `$file`
  inlines. Review it before you deploy. `files` is `[]` when nothing changed
  and `null` when there is nothing to diff against, with `diff.note` saying
  why. The diff is against the commit the live release recorded, not against
  what the server holds. A deploy from uncommitted changes records an
  approximate commit, so the next deploy cannot show a diff (`files` is `null`,
  with a note); it still publishes the files as they are now, so a revert is
  published too. Commit your `.zitadel/` changes before every `deploy` so the
  next diff is exact, and read the change back from the server afterwards.
  `schema get <objectType> --json` shows the newest uploaded revision, which
  is not necessarily the one the live deployment serves, so also check that
  the deployment went through (`deployment list --live`). Never treat `ok` as
  proof that the change is what you meant to publish.
- `deploy --dry-run` and `deployment create --dry-run` emit `data.targets` as
  `POST /deployments` takes it: the string `"primary"`, never a list.
- `deploy --dry-run` and `deploy` check every flow definition with the rules
  the server enforces: an error stops the deploy with `E_VALIDATION`, and a
  warning goes to `warnings` and does not. A flow warns, for example, when it
  serves `login` and `register` but leaves out the switch between them
  (`user_not_found`, `user_already_exists`), uses a cross-flow `switch` or
  `pivot` transition, which the engine does not run yet, declares a reserved
  purpose (`recovery`, `profiling`, `reauth`, `link_account`), or lets the
  login reach a `complete` step after identifying a user but before verifying
  a password, passkey or SSO sign-in (`warn/login-without-credential`), where
  the visitor is stopped with `att.not_completed`. A flow whose
  `user_schema` is the `objectType` of no schema in `.zitadel/schemas/` or in
  the project is an error. The same goes for user schemas: a key under
  `x-auth-methods` that is no authentication method (a misspelt `pasword`) is
  an error, named with the method it is likely meant to be.
- A write verb's `--dry-run` reports what it would send without calling the
  platform, so you can preview a mutation before making it.
- `user update --dry-run` is the exception: it also asks the server (the
  `dry_run` body field of `PATCH /users/{user_id}`), so it needs the credential
  the real update needs, and changes nothing. `data.result` is the user as the
  update would leave them. A refusal is the real update's error envelope: a
  failing attribute is in `details`, an array item by its index
  (`attributes.phones.0.fax`). A success holds for that moment only: a unique
  value that is free then can be taken before the real update. A server from
  before `dry_run` refuses the request (`E_VALIDATION`) and changes nothing.
- `api` emits the response body as `data`, exactly as the API reference
  documents it (`null` for a response without one); with `--paginate`, the
  page's list holds every page's items. `api --dry-run` emits the request
  instead: `{operation, method, url, body?}`. A refusal from the server is the
  error envelope, with its status and body in `details`.

Common error codes point at their own fix in `next_commands`:

- `E_VALIDATION`: the body or flags are wrong; `message` names what, and
  `details` often lists the missing or available values.
  A file under `.zitadel/` that cannot be written because a directory it needs
  is a file fails with `<path> cannot be written (ENOTDIR)`; `details.blocker`
  is that file. Remove it, then run the command again. A directory where a
  file is to be removed fails with `<path> cannot be removed (EISDIR)`; remove
  the directory, then run the command again.
- `E_CONFIRMATION_REQUIRED`: a destructive change waits for the user's yes;
  see "Ask the user before `--force`" above. Never add `--force` on your own.
- `E_CREDENTIAL_MISSING`: a connection's `client_id` or `client_secret` names a
  project variable that does not exist; `details.variable` is the name. Publish it
  with `variable set NAME` (add `--secret` for the secret), then retry.
- `E_LOCAL_SERVER_NOT_RUNNING`: start the local runtime, then retry with
  `--server local`.
- `E_NOT_FOUND`: an HTTP 404 — a missing resource, an operation the server's
  version does not have (`details.body.code` is `req.not_found`; a server
  from before the API moved under `/api/v1` answers every call so), or a
  `--server` that is not a Zitadel platform API. Follow `next_commands`.
- `E_PORT_IN_USE`: the requested local runtime port already has a listener; stop
  that process or choose another port.

In human mode the output follows the terminal (TTY table, or tab-separated lines
when piped or `--plain`); `--json` is unaffected and remains the contract. A
human run ends one of two ways. `setup`, which walks you through several
stages, draws a chain and closes on a boxed summary: what happened, the
commands to run next under `Next:`, `Explore all commands:` and where it
ran. Every other command ends on its result, with any next steps under `Next:`
and one dim footer line saying what it amounts to and where it ran; `status`
also ends on `Explore all commands:`. Where stdout is data a script reads (a
piped or `--plain` list, a resource's created or updated JSON) the next steps go
to stderr under `Next:`, so stdout holds only that data; so do a piped list's footer
and its empty-list line. A list's next-page command carries `--json` only when
the run was `--json`. A failure is written to
stderr, except inside a chain that is already drawn.

Text the server returns cannot drive the reader's terminal, in `--json` as in
human mode, but the two are spelled differently and only one is lossless.

- `--json` is written with the escapes JSON itself uses, applied to the
  serialised text and not to the values, so `JSON.parse` gives back exactly
  what the server sent, astral characters included. Read a value out of the
  envelope and send it back in an update as it came; you never need to call the
  platform API directly to recover it.
- Human output spells those characters as visible `\xNN`, `\uNNNN` or
  `\u{NNNNN}` text, so a value printed for a person is not the stored value
  byte for byte. Parse `--json` rather than scraping the human rendering.

Exit codes mirror the error class (3 = validation or confirmation required,
4 = network or not-found, 5 = conflict, 1 = auth, 2 = not-implemented,
130 = cancelled). `E_NETWORK`
covers a server that answered 5xx, one that refused for too many requests
(429), and one that never answered — refused, unresolvable, or silent past the
30-second request deadline; each is worth retrying, the rate limit after a
pause. `E_NOT_FOUND` also covers what the server says is gone (410), such as a
claim window that has closed, which retrying never recovers. Ctrl-C exits
130: a command waiting on the server, or on an answer at a prompt, stops at
once with `E_CANCELLED`, and any other command exits within a second, possibly
without an envelope. In human mode a cancel prints no error block. A name the
CLI cannot resolve to a command, an unknown command or an unknown subcommand,
is an `E_VALIDATION` envelope like any other, but it exits 127, as a shell
does for a command it cannot find. Its `next_commands` are the `--help` of the
command it was the plural of (`policies` alone names `policy --help`) or one
edit from, and of the topic. It is never run as a different command. Its message
names the first word that is no command where it was typed, as typed, and
never a word after that one. A stray extra word after a
real command is that command refusing an argument it does not take: an
`E_VALIDATION` envelope that exits 3, like any other refusal. Asking for help
on such a name is the one exception: the help layer answers, with nothing on stdout. With `--help`
among the arguments, even with `--json`, and as `zitadel help <name>`, it is a
plain `Command … not found` on stderr and exit 2. `zitadel help <name> --json`
is the help layer refusing `--json`, which it does not take: `Nonexistent
flag: --json` and a stack trace on stderr, and exit 1. Treat an empty stdout as
either case, never as an envelope. Everything else answers with an envelope
too, errors included — an unknown flag, a missing argument and a resource that
is not found are all `status: "error"` objects on stdout.

## Clarify before you configure

Driving the CLI non-interactively does not mean deciding *for* the user. When
the user asks to add authentication but has not said *how*, don't silently pick
defaults — ask them first, in one short batched question, then run the CLI
non-interactively with their answers. The two things sit on different sides of
the conversation: you clarify with the human, then drive the CLI headlessly.

Ask about:

- **Sign-in methods** — password (the usual default), passkeys, and single
  sign-on. If they want SSO, which providers? A provider the CLI does not list
  by name is still possible: run `zitadel auth-method sso enable --help` to see
  whether the installed CLI takes one, and which settings it needs, and ask for
  those too. In an interactive `setup`, Space ticks a provider and Enter
  continues; pressing Enter with none ticked asks whether to continue without
  setting up SSO, where No goes back to the list, so nothing is skipped by accident.
  A non-interactive run names the providers with `--sso` instead.
- **Profile fields** — which attributes sign-up collects. The starting field
  set depends on the use-case you pick (see *Presets and use-cases* below) —
  the default (`minimal`) is the login identifier only, **not** names. Confirm
  which fields they want (first/last name, phone, username, display name) and
  choose the use-case or edit the schema accordingly.

Offer only what the installed CLI actually supports: read the real sign-in
presets, profile fields, and SSO options from the CLI first (`setup --help`,
`resources --json`) and present those, not a list you remember — the options
move with the CLI version.

## Presets and use-cases — map the answers, don't trust the names

`setup` has two independent axes, and their names do **not** mean what they look
like. Read the current sets from `setup --help`, but know the traps:

- **Use-case = which profile fields the schema collects.** `minimal` is the
  login identifier **only** — it does *not* include names. First + last name is
  `--use-case consumer` (adds `givenName` + `familyName`); add a company with
  `--use-case business`. Choosing `minimal` because the developer said "keep it
  minimal" leaves an identifier-only schema that ignores the names they asked
  for. Every field but the identifier is **optional**; to require one, add it
  to the schema's `required` and `deploy`.
- **Preset = how they sign in (the login flow + auth methods).**
  `password-first` shows email and password first **but still leaves passkeys
  enabled** (not shown at sign-in); `passkey-first` shows a passkey first, with
  email and password as the alternative. Neither one gives you
  password-only. If the developer does not want passkeys, turn them off
  yourself: set `x-auth-methods.passkey.enabled` to `false` in
  `.zitadel/schemas/*.json`, then `deploy`.
- **No password reset yet.** The login offers no "Forgot password?" path and
  no preset adds one; tell the developer rather than promising one.

`setup`'s `data.sign_in` says what the axes added up to, read off the schema
it published: `starts_with` (`password` or `passkey`), `methods` (in the
schema's order), `fields` (`name` and `required`, in registration order),
`password_min_length` (null for none) and `providers` (slugs). The summary box
shows the same under *Sign-in*. Report it to the developer in their words.

Translate the developer's answers into the right axis values, then **verify
against what actually deployed**: read the live schema back
(`schema get <objectType> --json`) and confirm the fields and auth methods
match what they asked for — don't assume a preset name did it.

Skip the questions and proceed with the defaults above — stating the assumptions
you made so the user can correct them — in exactly two cases: the user already
told you what they want, or you are running non-interactively (a one-shot/headless
invocation) or were explicitly told to just set it up.

## Answering the user

Report what changed, in the user's terms — not how you drove the CLI. The
flags, `--json`, the deploy flow, exit codes, and the number of
commands you ran are your internal business; the user asked for an outcome, not
a transcript. Say what they got.

- Good: "Added an optional phone number to your user schema and deployed it."
- Avoid: "I ran `deploy` with `--non-interactive --json` and it returned ok."

Quote a command or flag only when the user asks *how* something works, or when
they need to run something themselves. Otherwise keep the mechanics out of the
answer.

## Golden path

The high-level workflow is stable even as individual flags evolve — run each
command's `--help` for its current flags (for example, `setup --help` lists the
framework, sign-in preset, and profile-field options):

```sh
npx @zitadel/cli@latest doctor --non-interactive --json
npx @zitadel/cli@latest start --non-interactive --json
npx @zitadel/cli@latest setup --framework next --server local --non-interactive --json
npx @zitadel/cli@latest doctor --non-interactive --json
npx @zitadel/cli@latest deploy -m "<why this release changes>" --non-interactive --json
```

`setup` commits the project it scaffolds: `git init` first when the directory
is not yet a repository, then one commit, `chore: scaffold the project with
Zitadel setup`. A release records the commit it was built from and `deploy`
diffs `.zitadel/` against it, so without this the first release carries no
commit and the next deploy reports no diff.

For a new TanStack Start app, the commit includes `src/routeTree.gen.ts`,
which setup generates after installing (the app's `generate-routes` script),
so the first dev run changes nothing. With `--skip-install` it is missing
until your install and first dev run write it: commit it then, with the
lockfile. In a TanStack Start app that already existed, setup adds routes but
does not regenerate the tree: run the dev server (or the app's
`generate-routes` script, where it has one), then commit `src/routeTree.gen.ts`.

Then setup deploys `.zitadel/` to the app's origin, so the sign-in it asks you
to verify is served the release it built. `data.deployment` carries the
`release_id`, `content_hash`, `deployment_id` and `origins`, and is null on
`--dry-run` or when the deploy failed. A failed deploy is a warning, never a
failed setup, and `data.next_commands` then leads with the `deploy` that fixes
it. Until that deploy succeeds, the project serves no sign-in.

To change the configuration later (a field, a login flow, a sign-in method),
edit `.zitadel/`, commit it, then deploy:

```sh
git add .zitadel && git commit -m "<why this release changes>" -- .zitadel
npx @zitadel/cli@latest deploy -m "<why this release changes>" --non-interactive --json
```

Commit first. A release records the commit it was built from, and records it
as approximate when the tree has uncommitted changes, which leaves the next
deploy no diff to show (`deploy --dry-run` reports no reliable diff). It also
leaves a clean tree for the next session, which remembers nothing of yours.
Skip the commit only when `git status` shows nothing under `.zitadel/`. If you
did deploy from an uncommitted tree, commit right away so the work is in git;
the next deploy still shows no diff.

When `git status` already shows uncommitted `.zitadel/` changes you did not
make, read `git diff`. Changes your request covers go in your commit. Anything
else you cannot account for is not yours to publish: tell the developer what
you found and ask before deploying it.

Setup refuses with `E_CONFLICT` when the repository already has uncommitted
work, untracked files included, which `details.untracked` lists separately
from `details.modified`. The commit covers the project directory, so it can
only tell its own files from yours when the tree starts clean. It never
commits `.env*` files (other than `.env.example`), `.zitadel/secret` or
`.zitadel/local/`, whatever their case. Commit or stash
first, then rerun. Only what `start` leaves is exempt: `.zitadel/local/` and
the `.gitignore` line that ignores it. A connection under `.zitadel/idps/` is
yours and is not exempt. During a merge, rebase, cherry-pick, revert or bisect,
or on a detached HEAD, setup refuses with `E_CONFLICT` before it writes
anything, naming what stops the commit.

`data.git` reports what setup did:
`initialized` when it ran `git init`, even if the commit then failed, and the
`commit`, or null. `--no-git` skips both the refusal
and the commit, and nothing prompts, so this is the same interactively and in
CI.

`setup` appends to `.gitignore` only what it needs, judged by what the lines
already there do, so every file that holds a secret is ignored and
`.env.example` stays committable after a generator's own `.env.*` and
`!.env.example`. `doctor` fails (`gitignore`) when a file that holds a secret
is not ignored, and warns when `.env.example` is, as an older setup left
SvelteKit, Nuxt and SolidStart apps; `doctor --fix` appends `!.env.example`
while the file names variables without values.

In an app that already exists, `setup` adds the sign-in, sign-up and profile
pages and the protection for the pages it guards, and leaves the app's own
pages as they are. Read the app's pages afterwards and add what the developer
asked for to them: a link to sign in on the page that should offer it, and a
sign-out control wherever they want one, copying how the generated profile page
signs out. Do not leave that for the developer to do.

`setup` scaffolds into an empty directory, or patches an existing app project
where it detects a framework. What `start` leaves in a directory —
`.zitadel/local/` and the `.gitignore` line that ignores it — still counts as
empty, so the golden path runs `setup` right after `start` in the same
directory. A `--cwd` that does not exist yet counts as empty too: setup creates
it with the app, and removes it again when setup fails before the app is kept.
A directory whose name is not a valid npm package name (`Tmp.W4SK1wDYDb`) is fine: the app is
created in a subfolder with a sanitized name and moved up, so its `package.json` carries the
sanitized name while the Zitadel project keeps the directory name.
A `--cwd` that is a file fails with `E_VALIDATION`. Any other non-empty
directory stops setup with a hint to pass `--force`. Pass it only for a
directory whose contents may be replaced: files
the new app also has, such as `package.json`, are overwritten. Without a
terminal `setup` cannot ask which framework to scaffold, so pass `--framework`;
the error lists the choices in `details.frameworks`. `setup --dry-run` creates
no app: where it would scaffold one, it previews the project, and
`data.files_written` is empty, because those files depend on the generated app.
`setup` also writes the password policy, which its first deploy publishes
(`.zitadel/policies/auth.factor.password.set.json`), with a minimum length of
15, NIST's minimum for password-only sign-in and the wizard's default. Pass
`--password-min-length <n>` only when the user asks for another value (`0` sets
none), and give test users passwords at least that long. It writes the
sign-up policy (`.zitadel/policies/user.create.json`) too, which that deploy
publishes: the default, the built-in proof of work every password or passkey
sign-up solves with or without the file; sign-in provider sign-ups are not
challenged. A server too old to take it gets a warning and no file; a file
`--force` kept stays, and every `deploy` fails until the server is upgraded or
the file moves out of `.zitadel/policies/`.
When setup fails after scaffolding a new app, before its default schema and
flow files are written, it removes the app again and puts back what the
directory held, so rerunning the same `setup` starts over. Setup writes
`.zitadel/` and publishes it only through its first deploy, so a failed deploy
leaves every file in place: run the suggested `deploy`, not `setup` again.

`start` reuses a server already running in the directory only when it is the
release this CLI ships; one an earlier release started is restarted, and its
data stays. `setup --server local` refuses a binary-runtime server another
release started with `E_CONFLICT` before it creates anything: that server's API
is its own release's. Its `next_commands` run `start`, then `setup` again.

In an existing app, `--framework` has to name the framework setup detects
there; another one stops setup with `E_CONFLICT` instead of offering
`--force`. Setup reports its conflicts with the app before it creates a
project, and the error's `hint` says whether `--force` resolves one: it
replaces a file at a path setup writes, but not the app's root component or
request boundary at another path.

The app may also live in a subdirectory of the one `start` ran in: `setup`,
`console`, `logs`, `--server local` and `doctor` read `.zitadel/local/` from the working
directory or the nearest parent that has it (up to the home directory), so
`mkdir my-app && cd my-app` after `start` works too. `doctor` checks that
server and its port, but runs its project checks in the working directory, so run
it from the app. When that server is unhealthy it suggests `start` and
`reset --force` with `--cwd` set to the directory that holds it (quoted where the path
needs it; `doctor --json` also returns the argument lists in `details.suggested_args`).
The hint says the server is the parent's and that `reset --force` deletes the data in that
directory, and it adds a plain `start`, which gives the working directory a server of its own
because `start` does not look in parents; a healthy parent server is reported in the `runtime`
check as started in the parent folder. A
local server is healthy once its `/readyz` answers, which takes its database
answering too: `start` waits for that, and the commands that read a server
treat one whose database does not answer as unhealthy. `stop`,
`reset` and `status` read only the working directory's
`.zitadel/local/`, so run them where `start` ran. On a local
server that hosts the platform project, `setup` attaches the project to the
local admin's team and puts `console` in `data.next_commands`; when it finds
no local admin for that server on the way up, it says so in the envelope's
`warnings` and the project stays unattached, so the local console does not
list it. A run that set up no social sign-in provider also puts the `auth-method sso enable --provider google`
command in `data.next_commands`, so a later provider is one step away.

`reset` asks before it deletes the local server's database, which cannot be undone, and keeps
`.zitadel/local/admin.json`.

For a project set up against a hosted server, `doctor` checks no local
runtime, unless a local server was started in its directory or a parent, or
`--port`, `--runtime` or `--image` asks about one.

When `setup --sso` or `auth-method sso enable` adds a social sign-in provider, the user
must register the connection's redirect URI with the provider themselves: give
them `data.sso[].callback_uri` from `setup`, or `data.callback_uri` from
`auth-method sso enable`, verbatim. Each connection has its own URI, so a URI from another
provider or an older CLI version does not work. `data.callback_uri` is the development URI only. The
text output of `auth-method sso enable` also lists the URI for each deployed origin, and one pattern for
each preview origin, since a preview URL is known only when its build runs. A preview pattern is not a
URI to register: replace it with the concrete preview URL first. A JSON caller reads the project's origins
with `origin list` and builds the same URIs itself.

The same results carry the connection's `claim_mapping` (user attribute to
claim), `verified_claims` (what makes an attribute verified: a claim's name, or
`true` when the provider is trusted outright), `scopes`, `unmapped` (the
attributes no claim fills, each with `required`) and `used_by` (the schemas that
sign in through it) in `data.sso[]` from `setup` and `data.connection` from
`sso enable`. To map another claim, edit `claim_mapping` in the connection file
named there, then run `deploy`; the connection is not tested until a real
sign-in. `deploy` refuses a mapping that cannot work and names the file, the
problem and the fix: a target no schema defines (with a "Did you mean" when one
is close), an empty `claim_mapping`, a `verified_claims` key with no mapping, and
a claim name with a space at its start or end. Mistakes that almost certainly
do not do what was meant warn but do not stop, so `deploy` carries on: a
standard claim of a type the property
cannot hold, a verification that reads a claim that is not a boolean, a
`subject_claim` that is a profile claim (only until the connection is first
deployed, after which it cannot change), and a connection that reads a
standard claim without the scope that returns it. Fix the file named.

In a terminal, `setup --sso custom` asks for the name the sign-in button shows
first, then offers a connection name made from it (`Zitadel Cloud` offers
`zitadel-cloud`) for the user to accept or edit; a name that would be a built-in
provider's (`google`, `custom`) is offered empty. A scripted, `--json` or
`--non-interactive` run asks nothing and still needs `--sso-slug`,
`--sso-display-name` and `--sso-issuer`. `auth-method sso enable` keeps asking for
the connection name first.

After `setup`, follow `data.next_commands` to start the app. Prove the generated
auth flow in a visible browser by registering a unique user at `/register`,
logging out, logging back in at `/login` with the same email/password, and ending
on the signed-in profile page.
Do not treat a rendered login or registration form as completion.

When a step against the local server fails without saying why (the login says a
sign-in provider "is not available right now", or a request returns 500), the
server logged the cause. Read it with `logs --level warn --json`: `data.logs`
holds the warnings and errors, and `--tail` counts only those lines. `logs
--follow` streams the log for a person at a terminal, with warnings yellow and
errors red; it refuses `--json`. `start`, and `doctor` when it finds the server
running, name it in `data.next_actions`.

To move a set-up app to another dev port (setup's `warnings` say the port is
already in use, the dev server exits with `EADDRINUSE`, or another app needs
the port), run `setup --dev-port <port>` in the app; never change the port in
one file by hand. In a directory with a
`zitadel.json`, `setup` returns `status: "skipped"` with `reason:
"already-initialized"`, unless `--dev-port` is given: then it moves the app.
It allows the new origin on the server first, and a refusal changes nothing.
It then rewrites the dev script or dev-server config, `ZITADEL_ISSUER` in
`.env.local`, `zitadel.json`, `.zitadel/secret` and the README/AGENTS.md
guidance, and deploys the release the old port ran again so the new origin
serves it: `data.deployment_id` names that deployment, `null` when none was
made. When the new origin serves nothing yet, `warnings` says why and
`next_commands` holds the `deploy`. Last, it removes the old origin, which
asks first: non-interactive, pass
`--force` to remove it, or `warnings` says it was kept and `next_commands`
holds the `origin rm … --force` that removes it. `data.previous_issuer` and `data.issuer`
name both origins, and `data.moved` is `false` when the app was already on that
port. A social sign-in provider still redirects to the old port: `warnings`
names the redirect URI to add at each provider, listing each by its
connection slug (by file name for a connection file that is broken). The move
reads `.zitadel/idps/` before it changes anything and stops when that
directory cannot be read. Restart the dev server afterwards.

To change how users sign in after setup, use the `auth-method` commands. Each
sign-in method has its own command, with `--schema` when the project has more
than one. `--schema` takes the schema's file name or its `objectType`;
`<file>.json` names the file alone when the two collide:

- `auth-method password enable` and `auth-method password disable`
- `auth-method passkey enable` and `auth-method passkey disable`
- `auth-method sso enable --provider google` adds a provider. It prompts for
  the client id and secret, or takes `--client-id` with the secret piped on
  stdin when non-interactive. Any other OpenID Connect provider is
  `--provider custom` with `--slug`, `--display-name`, `--issuer` and optionally
  `--scopes` (default `openid profile email`).
  `--dry-run` asks for and reads no credentials: it prints the callback URI and
  where to register the client. `data.connection`, `data.changed` and
  `data.would_store` name the connection file, the files the run would write
  (a new connection's `.zitadel/idps/<slug>.json` first, then the schema and
  flow files) and the project variables it would store. The text output lists
  them as `Would write <file>` and `Would store <variables> on the project`,
  and a notice about a region left alone says it "would be" left alone. A
  provider route you wrote yourself in a flow is kept, not reset, and
  `data.notices` says so.
  In a terminal, a custom provider's settings you leave out are asked for, after
  the checks that need no answer; a connection that already has that slug
  supplies its own. A scripted, `--json`, `--dry-run` or `--non-interactive`
  run must pass all three and gets an error naming the missing ones. The text
  output, `--dry-run` included, prints a notice saying which claim fills each user
  attribute, which attributes no claim fills (marked required or optional) and
  which schemas sign in through the connection; `--json` carries the same in
  `data.connection` as `claim_mapping`, `verified_claims`, `scopes`, `unmapped`
  and `used_by`.
  An issuer on `http://localhost:<port>` (a test provider on this machine)
  works against a server `zitadel start` runs as a process: `start` sets
  `NEXTGEN_HTTPCLIENT_ALLOW_LIST=localhost,127.0.0.0/8,::1/128` unless
  `.env.local`, `.env` or the shell sets it, and setting it empty turns it off.
  Under `--runtime docker` localhost is the container, so the provider is not
  reachable. Otherwise `sso enable` warns in `warnings` that sign-in will fail.
  `auth-method sso disable --provider google` removes a provider; a custom one
  is named by its slug, as in `auth-method sso disable --provider acme-sso`.
  A provider the schema and its flows do not offer fails with `E_NOT_FOUND`,
  listing the offered providers and connections, unless the catalog lists it or
  a `.zitadel/idps/` connection names it; then the run is an `ok` no-op.
  It keeps the connection file, its variables and the `register-sso` /
  `sso-conflict` steps, and says so in `data.notices`. When nothing else offers
  the provider, `data.next_actions` says to delete the file before deploying
  and to `variable rm` its variables once that deploy is live, in that order.

Every `auth-method` result carries `data.notices`, a list of `{severity,
message}` (`severity` is `warning` or `info`): what the change left alone, kept
or still needs doing, such as the files `sso disable` keeps. The text output
prints the same notices.

The commands change only local files, apart from
`auth-method sso enable`, which also stores the provider's credentials on the
project. A provider added by `sso enable` is configured locally, not live: its
`data.title` says so, `data.next_actions` says to deploy, and `data.next_commands`
holds `deploy --dry-run` then `deploy`. Only run those once the provider's OAuth
application exists. `data.client_id.published` and `data.secret.published` say whether the
credentials reached the project; `data.title` says only that the provider is configured locally.
When they refuse, they write and publish nothing, on a dry run too.
They refuse to run while any file under `.zitadel/` does not parse, fails its
contract or fails the per-file checks `deploy` makes (a literal `client_secret`,
a branding template or `$file` that cannot be read or breaks the template
rules, a connection field its contract does not know, a problem with its
endpoints), even a file the command
does not change (`E_VALIDATION`, with each file and finding in
`details.problems`), changing nothing; fix the files named, then run the command
again. A schema whose `x-auth-methods` is not the shape the contract expects is
such a file. They refuse to write or remove a file under `.zitadel/` whose path,
through a symlink, resolves outside `.zitadel/`; reading still follows
symlinks. They refuse
to disable a method a login flow still asks for, to change a method
while a login flow has errors that prevent checking it, to enable password on a
schema without `x-identifier`, to edit a value that is not the shape they edit,
and to edit a schema that points at an external URL. When they refuse to disable a
method, `details.steps` lists each step that uses it with what it `keeps`
without it (empty when it would have no field or sign-in method left), the
purposes it is the entry step of (`entry_for`) and the transitions of other
steps that lead to it (`targeted_by`, each `{step, transition}`, with
`purpose` when it names only a purpose and so follows that purpose's entry
step). Disabling the schema's last
way to sign in needs `--force` when non-interactive; only pass it for a schema
whose users are managed through the API, and ask the user first. That refusal's
`details.suggested_args` lists the `--force` re-run first, then the methods that
could be enabled instead. A non-interactive dry run refuses it the same way, and its
`--force` re-run keeps `--dry-run`; with `--force` it previews the change and
warns that no way to sign in would be left. A method that is enabled but not
offered by any flow is reported in `warnings` (and in `data.not_offered`
for password and passkey); for those two the warning says what to add, and
names the login flow files to add it to. Every command reports `data.changed`, the
project-relative files it wrote (on a dry run, the files it would write), empty
when nothing changed. Follow `data.next_commands` (`deploy --dry-run`, `deploy`, and
`variable set` when a credential did not reach the project) to publish the
change, committing it first. When a path or schema name would need shell quoting, `next_commands` is
empty and `data.next_args` (or `details.suggested_args` on a refusal) holds the
same commands as argument lists.

Repo config is authoritative: edit `zitadel.json` or files under `.zitadel/`,
then re-run `deploy`. See the reference below for driving the login UI
and the config-sync details. The editor schemas in `.zitadel/meta/` are
generated by the CLI, not config: never edit them. `doctor` warns when one is
missing or outdated (after an upgrade that changed a dialect), and
`doctor --fix` writes the current ones, unless the project pins a newer
`@zitadel/*` version (run that version's `doctor --fix`) or a symlink is on
the path. `setup` and `branding eject` write a missing one and replace an
outdated one the same way, and never replace one when the project pins a newer
`@zitadel/*` package. `deploy --dry-run` validates without them either way.
`doctor`'s `schema` check holds every file under `.zitadel/` to the rules
`deploy` validates with: it fails on an error and warns on a warning. It holds
no environment, so `environment/missing-variable` is checked only by `deploy`.
When `sso/subject-claim-unstable` could apply, `doctor` (like `deploy`) lists
the project's connections on the server, using `zitadel.json` and
`.zitadel/secret`; when the listing cannot be read, both leave that one warning
out rather than give it for connections already deployed.
`deploy`, `preview` and `release create`, `--dry-run` included, check
`.zitadel/` locally before anything is written, and refuse with one
`E_VALIDATION`, `Configuration validation failed (N issues)`. `details.issues`
lists every error as `{rule, path, steps?, message}`: the rule's id, the file,
the flow steps when the rule names any, and what is wrong. There is no
`handle` or `step` field. Every failure a file can have is an issue of that one
error: a file that does not parse or fails its contract, a flow the server's
flow rules refuse, a connection that disagrees with a schema or flow, and a
variable the environment lacks (`environment/missing-variable`, one issue per
file that references it). The hint says to fix the files and re-run, and for a
literal `client_secret` (`connection/literal-secret`) to publish it with
`variable set NAME --secret` and reference it as `"${{ NAME }}"`. Warnings in
`warnings` start with the file's path. The server still applies its own
release rules when the build is submitted, such as handles being unique, so a
passing dry run does not promise the release is accepted.

A flow is matched to a local schema by the schema's `objectType`, its `$id`, an
id `.zitadel/state.json` records for it, or, for a schema with no `$id`, the
file name at the end of the flow's `user_schema` URL (a schema file that only
points at an external schema is matched by name alone). The flow and sign-in
rules apply to every flow a schema matches this way.

`pull` writes `.zitadel/` from the schema and flow revisions a release pins. It
fetches every revision before it writes a file, and refuses, writing nothing,
when a pinned handle cannot be a file name (`E_VALIDATION`), when two broken
files in `.zitadel/` hold the same handle (`E_CONFLICT`), or when two pinned
handles would be written to one file (`E_CONFLICT`).
`policy test` reads every file under `.zitadel/policies/`; a file that is not
valid JSON is listed, as text, in `details.issues` of its `E_VALIDATION`
(naming one operation limits that to its own files).

An SPA's dev proxy (`vite.config.*`, Angular's `proxy.conf.cjs`) keeps the
app's session in a cookie of its own project, `zitadel_session_<project id>`
on `http://localhost` and `__Host-zitadel_session_<project id>` over https.
`doctor` fails (`managed-files`, `outdated managed config wiring`) on the
session-cookie hooks a CLI wrote before these names: the server no longer
reads the cookies they keep. `doctor --fix` replaces hooks that are as the CLI
wrote them; ones changed by hand must be updated by hand, which the failure
says. Browsers signed in before the change sign in again.

A Vite app's dev proxy (React, Vue, Solid, Svelte, Qwik) reaches the server
at `ZITADEL_URL`, read with Vite's `loadEnv`: the process environment first,
then `.env.development.local` (which `setup` writes it to, beside
`.env.local`), `.env.development`, `.env.local` and `.env`, then the address
`setup` ran against, which `vite.config.*` carries as the fallback. So a test
run points the app at its own server through the environment, and an app
without the variable keeps working. An empty value counts as unset and hides
the sources below it: an empty `ZITADEL_URL` in the process environment skips
the env files and lands on the fallback. A value that is no http(s) URL stops
the config from loading, `vite build` included, naming the variable; one with a
path is reduced to its origin. A proxy an older CLI wrote fixes the address in
`vite.config.*`: it still works, and `doctor` warns (`managed-files`,
`unapplied managed config edit(s)`). `doctor --fix`, which `upgrade` runs,
turns it into the current target with that address as the fallback, moving
nothing between files, so with the env files as they are the app reaches the
same server; a `ZITADEL_URL` the shell or CI exports now takes effect. It leaves the proxy alone, with a warning naming both
addresses and the file, while the env files set `ZITADEL_URL` to another
server, and it warns about a proxy changed by hand or a target set on purpose
without touching either. Angular's `proxy.conf.cjs` reads the process
environment, then `.env.local`, and stops when neither sets `ZITADEL_URL`.

## Testing the app

When the developer wants automated tests of the sign-in, or of pages behind
it, reach for `@zitadel/testing`. It boots its own Zitadel server and
project per test run, seeds users and sessions through the API, and ships
Playwright fixtures and login helpers. It never uses the project `setup`
created or the runtime `start` runs.

- Add it only when the developer asks: it installs Playwright. `setup`
  installs no test tooling; `status` mentions `tests add` in `next_actions`
  once a sign-in has worked, never in `next_commands`.
- In a Next.js app `setup` wired up, run `tests add --non-interactive --json`,
  then its `next_actions` (Chromium, once) and `next_commands`: it writes a
  sign-in test and a signed-in test, adds the dev dependencies and a
  `test:e2e` script. `tests add --help` lists what it writes and refuses.
  Another framework: wire the kit by hand. A React, Vue, Solid, Svelte or
  Qwik app `setup` wired takes the kit's `viteAppEnv` as `app.env`.
- Seed a user per test (`seed.user()`) and drive the real login
  (`loginWithPassword`) to test the sign-in itself.
- Start other tests signed in (`authenticatedPage`, or `seed.session()` for
  session APIs without a browser) instead of driving the login again.
  Headless sessions cover password flows only.
- Passkey tests need Chromium and the kit's virtual authenticator.
- Preview, macOS and Linux only.

The kit's README holds its API; read it and the package's types rather than
guessing: <https://github.com/zitadel/nextgen/tree/main/packages/testing#readme>.
The worked setup for an app `setup` scaffolded is
<https://preview.zitadel.com/docs/guides/test-your-app.md>.

## Claiming a project

A project on a hosted server stays temporary until a person claims it, within
14 days of `setup`. Claiming signs that person in with their own Zitadel
account in a browser, so it is their step: hand them the link, and never open
it yourself. Plain `claim` waits for the browser step and prints nothing on
stdout until it ends, so run `claim --no-wait --non-interactive --json`
instead. It returns at once with `data.claim_url`, the link to give the person
verbatim, and `data.expires_at`, when it stops working (about 10 minutes).
Then run the `claim --challenge-id …` command in `data.next_commands`: it
waits for the person to finish, returns `data.dashboard_url`, and records the
owning team in `.zitadel/secret`. When the link expires, or `--challenge-id`
names one the platform does not know (`E_NOT_FOUND`), `next_commands` starts a
new `--no-wait` link. A project that already has a team is `skipped` with
`reason: "already-claimed"`; one past its 14 days fails with `E_VALIDATION`
and no `next_commands`, since a new link cannot reopen it.

## Reference files

Load on demand:

- [`references/driving-login-ui.md`](references/driving-login-ui.md) — driving the
  `<zitadel-login>` component in a browser, and the authoritative repo-config
  workflow (schemas, flows, branding, policies and their tests).
