---
name: zitadel-cli
description: >-
  Set up and manage Zitadel authentication in a local project with the
  agent-friendly `zitadel` CLI. Use when the user wants to add login,
  registration, or session handling, create a Zitadel project, scaffold auth
  for a Next.js, Nuxt, SvelteKit, SolidStart, Qwik Router, TanStack Start, React,
  Vue, Angular, Solid, Svelte, or Qwik app, or build and deploy Zitadel config
  changes from repo state.
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
  the command's `--help` to see which flags exist and which are required.
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
  serves the server's own defaults until something is deployed to it: run the
  `deploy` the result's `next_commands` names, against the file it wrote
  (`--env-file .env.<name>.local`). A person at a terminal is asked whether to
  deploy there and then; your runs never are, so they never deploy — run that
  `deploy` yourself. `data.deployment` carries the `release_id`,
  `content_hash`, `deployment_id` and `origins` when a person accepted, and is
  null otherwise — a failed deploy is a warning, never a failed `env add`.
  `ZITADEL_URL` and `--server` are the server's origin: the API lives under
  `/api/v1` there, which the CLI adds (and drops from a URL that already ends
  in it).
- **Origins.** `zitadel origin add <url> --kind primary|preview`, `origin list`
  and `origin rm <url>` manage the URLs a project serves: a `primary` origin is
  where the app is served, a `preview` pattern (it may hold a `*`) is where
  pull-request builds run. They need the project secret, not the preview token.
  An empty list admits every origin, so removing the last one opens the project
  up; `origin rm` asks first and needs `--force` when non-interactive. Removing
  a preview pattern leaves its live previews served until they expire.
  `deploy` lands only on primary origins and fails with `E_VALIDATION` without
  one; its `next_commands` name the step that gives the project one. `setup`
  0.1.0 registered the app's URL (`ZITADEL_ISSUER`) as a `preview` origin,
  which `origin add --kind primary` refuses with `E_CONFLICT`: `doctor` warns
  (`issuer-origin`) and `doctor --fix` makes it primary, which asks first;
  non-interactive, pass `--force` too, or `warnings` says the repair waited.
- **Telemetry.** The CLI sends anonymous usage telemetry by default, and
  agent-driven runs are exactly the ones worth learning from — leave it on.
  Don't add `--no-telemetry` to commands. An opt-out exists for users who need
  it (`ZITADEL_TELEMETRY=0`, or the standard `DO_NOT_TRACK`, in their
  environment), but that is the user's environment choice, not a flag to attach
  to every call.
- **Flag conventions.** Flags follow what a model already expects from curl, ssh
  and wget: `--help`/`-h`, `--version`, `-v`/`--verbose`, kebab-case long flags,
  both `--flag value` and `--flag=value`, and `--no-telemetry`-style negation.
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
  (a user attribute, a project's own password hash), so it asks first and
  needs `--force` when non-interactive.
- **Calling an operation no command covers.** `zitadel api <operation>` calls
  any operation of the API with the resolved server and `.zitadel/secret`. One
  that deletes, revokes or rolls back asks first and needs `--force` when
  non-interactive, as the command that covers it does; so does a merge-patch
  body with a `null` (`updateVariables`, `PatchUserByID`, `patchMyUser`,
  `patchProject`), which removes what it names.
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
command and resource names — including whether a resource is singular or plural
and the exact verb — are whatever the CLI shows, never what you would assume. A
wrong guess costs a failed call and a round of recovery; one cheap lookup up
front avoids it. `zitadel --help` lists each family of commands (`users`,
`release`) as one row, so it stays short; `zitadel commands` is the flat list of
every command, verbs included, and `zitadel <family> --help` lists one family's
verbs. Treat the CLI's own output as authoritative over anything you remember:

```sh
npx @zitadel/cli@latest --help               # every command family, grouped by purpose
npx @zitadel/cli@latest commands             # flat list of all commands
npx @zitadel/cli@latest <command> --help     # a command's flags, which are required, and examples
npx @zitadel/cli@latest resources --json     # the resource surface in one call (see below); contacts no server
npx @zitadel/cli@latest api ls --json        # every API operation, its parameters, body and paging; contacts no server
```

`--help` groups the commands by what you are doing: getting started, local
development, users and teams, authentication, configuration and releases, and
diagnostics and utilities. A family such as `users` is one row, and
`zitadel users --help` lists its verbs. Read the groups from `--help` rather than
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

To find the users still on an older revision of a schema, filter on the
schema's object type and exclude the newest revision's URL:
`users list --filter schema_object_type=equals:<type> --filter
schema=not_equals:<newest-url> --all --json`.

## Reading the envelope

Each invocation prints one JSON object:

- `status`: `ok` | `skipped` | `error`.
- `cli_version`, `command`, `source`: always present.
- On success: `data` with the command-specific payload.
- On a no-op: `reason` (e.g. `already-initialized`, `already-claimed`,
  `nothing-to-eject`).
- On failure: `code` (e.g. `E_VALIDATION`, `E_NETWORK`, `E_NOT_FOUND`,
  `E_CONFLICT`) and `message`, usually with a `hint`, and `details` when there
  is structured context.
- `next_commands`: the suggested follow-ups, inside `data` on success and at
  the top level on a no-op or failure. Prefer these over free-text hints.
- `warnings`: things that went wrong without stopping the command, such as a
  value that was not published. Always present on success (often empty), and
  present on a no-op or failure when there are any. Read them before you report
  success: a warning usually means a follow-up step is needed.
- A `list` verb emits `data: { items, count, next_page_token }`; when a page
  remains, `data.next_commands` carries the exact command for the next page.
- `deploy` emits `data.content_hash` (the release digest), `data.origins`
  (the origins it went live on) and `data.resources` (how many it pinned). A
  re-run on unchanged config returns the same digest. Use it to confirm what
  went live.
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
- `deployment get <id>` emits the deployment as the API serves it; on a
  terminal it also shows the variables the deployment froze, secrets masked.
  Read them as JSON with `variable resolve`.
- `deployment rollback` emits `data.release_id` (the release live again),
  `data.origins` and `data.pointers`, the `{kind, handle, revision_id}`
  revisions that release pins; the `schema` one is what new registrations use.
  Users keep their schema revision and attributes: a rollback does not migrate
  them back. Without `data.pointers`, a warning says the release could not be
  read.
- `deploy --dry-run` and `deploy` emit `data.diff`, the git diff the terminal
  shows, against the live release's commit (`diff.against`): `diff.files` holds
  one `{path, status, previous_path?, patch}` per changed file (`status` is
  `added`, `modified`, `deleted`, `renamed` or `copied`; `patch` is its unified
  diff), including rapid same-size edits and untracked configuration files.
  Review it before you deploy. `files` is `[]` when nothing changed and
  `null` when there is nothing to diff against, with `diff.note` saying why.
- A write verb's `--dry-run` reports what it would send without calling the
  platform, so you can preview a mutation before making it.
- `api` emits the response body as `data`, exactly as the API reference
  documents it (`null` for a response without one); with `--paginate`, the
  page's list holds every page's items. `api --dry-run` emits the request
  instead: `{operation, method, url, body?}`. A refusal from the server is the
  error envelope, with its status and body in `details`.

Common error codes point at their own fix in `next_commands`:

- `E_VALIDATION`: the body or flags are wrong; `message` names what, and
  `details` often lists the missing or available values.
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
human run lists its next steps under `Next:` after its result (`setup` shows
them in its summary box instead); where stdout is data a script reads (a piped
or `--plain` list, a resource's created or updated JSON) they go to stderr, so
stdout holds only that data.

Text the server returns is escaped before it is printed, in `--json` as in human
mode, so a stored value cannot drive the reader's terminal. Control, format and
bidi characters appear as visible `\xNN`, `\uNNNN` or `\u{NNNNN}` text, so a
value that contained one is not the stored value byte for byte — do not send it
back in an update as if it were. When you need the exact value, call the platform
API directly with the project secret.

Exit codes mirror the error class (3 = validation, 4 = network or not-found,
5 = conflict, 1 = auth, 2 = not-implemented, 130 = cancelled). `E_NETWORK`
covers a server that answered 5xx and one that never answered — refused,
unresolvable, or silent past the 30-second request deadline. Ctrl-C exits
130: a command waiting on the server, or on an answer at a prompt, stops at
once with `E_CANCELLED`, and any other command exits within a second, possibly
without an envelope. In human mode a cancel prints no error block. An
unknown command is handled by the CLI's help layer, not the envelope.

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
  those too.
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
  for.
- **Preset = how they sign in (the login flow + auth methods).**
  `password-first` makes password the primary step **but still leaves passkeys
  enabled**; `passkey-first` leads with a passkey. Neither one gives you
  password-only. If the developer does not want passkeys, turn them off
  yourself: set `x-auth-methods.passkey.enabled` to `false` in
  `.zitadel/schemas/*.json`, then `deploy`.

Translate the developer's answers into the right axis values, then **verify
against what actually deployed**: read the live schema back
(`schemas get <objectType> --json`) and confirm the fields and auth methods
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
zitadel setup`. A release records the commit it was built from and `deploy`
diffs `.zitadel/` against it, so without this the first release carries no
commit and the next deploy reports no diff.

Then setup deploys `.zitadel/` to the app's origin, so the sign-in it asks you
to verify is served the release it built. `data.deployment` carries the
`release_id`, `content_hash`, `deployment_id` and `origins`, and is null on
`--dry-run` or when the deploy failed. A failed deploy is a warning, never a
failed setup, and `data.next_commands` then leads with the `deploy` that fixes
it.

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

Setup deploys nothing, and it does not need to: a project with no release
resolves the newest revisions, which are the ones setup just uploaded, so
sign-in already runs on `.zitadel/`. Deploying pins them into a release, which
is what the server will require once that fallback goes (#1616). The publish
step says so and names the command. `data.git` reports what setup did:
`initialized` when it ran `git init`, even if the commit then failed, and the
`commit`, or null. `--no-git` skips both the refusal
and the commit, and nothing prompts, so this is the same interactively and in
CI.

`setup` scaffolds into an empty directory, or patches an existing app project
where it detects a framework. What `start` leaves in a directory —
`.zitadel/local/` and the `.gitignore` line that ignores it — still counts as
empty, so the golden path runs `setup` right after `start` in the same
directory. A `--cwd` that does not exist yet counts as empty too: setup creates
it with the app, and removes it again when setup fails before the app is kept.
A `--cwd` that is a file fails with `E_VALIDATION`. Any other non-empty
directory stops setup with a hint to pass `--force`. Pass it only for a
directory whose contents may be replaced: files
the new app also has, such as `package.json`, are overwritten. Without a
terminal `setup` cannot ask which framework to scaffold, so pass `--framework`;
the error lists the choices in `details.frameworks`. `setup --dry-run` creates
no app: where it would scaffold one, it previews the project, and
`data.files_written` is empty, because those files depend on the generated app.
`setup` also writes and publishes the password policy
(`.zitadel/policies/auth.factor.password.set.json`) with a minimum length of
15, NIST's minimum for password-only sign-in and the wizard's default. Pass
`--password-min-length <n>` only when the user asks for another value (`0` sets
none), and give test users passwords at least that long.
When setup fails after scaffolding a new app, before its default schema and
flow are uploaded, it removes the app again and puts back what the directory
held, so rerunning the same `setup` starts over.

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
`reset --force` with `--cwd` set to the directory that holds it (when that path needs
shell quoting the commands are left out, the hint names the directory, and
`doctor --json` returns the argument lists in `details.suggested_args` to run as they are).
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
local admin's team and ends `data.next_commands` with `console`; when it finds
no local admin for that server on the way up, it says so in the envelope's
`warnings` and the project stays unattached, so the local console does not
list it.

For a project set up against a hosted server, `doctor` checks no local
runtime, unless a local server was started in its directory or a parent, or
`--port`, `--runtime` or `--image` asks about one.

When `setup --sso` or `auth-method sso enable` adds a social sign-in provider, the user
must register the connection's redirect URI with the provider themselves: give
them `data.sso[].callback_uri` from `setup`, or `data.callback_uri` from
`auth-method sso enable`, verbatim. Each connection has its own URI, so a URI from another
provider or an older CLI version does not work.

After `setup`, follow `data.next_commands` to start the app. Prove the generated
auth flow in a visible browser by registering a unique user, logging out, logging
back in with the same email/password, and ending on the signed-in profile page.
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
guidance, and removes the old origin, which asks first: non-interactive, pass
`--force` to remove it, or `warnings` says it was kept. `data.previous_issuer` and `data.issuer`
name both origins, and `data.moved` is `false` when the app was already on that
port. A social sign-in provider still redirects to the old port: `warnings`
names the redirect URI to add at each provider. Restart the dev server
afterwards.

To change how users sign in after setup, use the `auth-method` commands. Each
sign-in method has its own command, with `--schema` when the project has more
than one:

- `auth-method password enable` and `auth-method password disable`
- `auth-method passkey enable` and `auth-method passkey disable`
- `auth-method sso enable --provider google` adds a provider. It prompts for
  the client id and secret, or takes `--client-id` with the secret piped on
  stdin when non-interactive. Any other OpenID Connect provider is
  `--provider custom` with `--slug`, `--display-name`, `--issuer` and optionally
  `--scopes` (default `openid profile email`).
  In a terminal, a custom provider's settings you leave out are asked for, after
  the checks that need no answer; a connection that already has that slug
  supplies its own. A scripted, `--json`, `--dry-run` or `--non-interactive`
  run must pass all three and gets an error naming the missing ones. After
  writing a new connection the text output prints the claim mappings and names
  the file to edit them in; `--json` does not carry them, so read the
  connection file.
  An issuer on `http://localhost:<port>` (a test provider on this machine)
  works against a server `zitadel start` runs as a process: `start` sets
  `NEXTGEN_HTTPCLIENT_ALLOW_LIST=localhost,127.0.0.0/8,::1/128` unless
  `.env.local`, `.env` or the shell sets it, and setting it empty turns it off.
  Under `--runtime docker` localhost is the container, so the provider is not
  reachable. Otherwise `sso enable` warns in `warnings` that sign-in will fail.
  `auth-method sso disable --provider google` removes a provider; a custom one
  is named by its slug, as in `auth-method sso disable --provider acme-sso`.

The commands change only local files, apart from
`auth-method sso enable`, which also stores the provider's credentials on the
project. A provider added by `sso enable` is configured locally, not live: its
`data.title` says so, `data.next_actions` says to deploy, and `data.next_commands`
holds `deploy --dry-run` then `deploy`. Only run those once the provider's OAuth
application exists. `data.title` claims the credentials are stored on the project
only when they reached it. When they refuse, they write and publish nothing, on a dry run too.
They refuse to disable a method a login flow still asks for, to change a method
while a login flow has errors that prevent checking it, to enable password on a
schema without `x-identifier`, to edit a value that is not the shape they edit,
and to edit a schema that points at an external URL. Disabling the schema's last
way to sign in needs `--force` when non-interactive; only pass it for a schema
whose users are managed through the API, and ask the user first. That refusal's
`details.suggested_args` lists the `--force` re-run first, then the methods that
could be enabled instead. A dry run of the change is not refused: it previews it
and warns that no way to sign in would be left. A method that is enabled but not
offered by any active flow is reported in `warnings` (and in `data.not_offered`
for password and passkey). Every command reports `data.changed`, the
project-relative files it wrote (on a dry run, the files it would write), empty
when nothing changed. Follow `data.next_commands` (`deploy --dry-run`, `deploy`, and
`variable set` when a credential did not reach the project) to publish the
change. When a path or schema name would need shell quoting, `next_commands` is
empty and `data.next_args` (or `details.suggested_args` on a refusal) holds the
same commands as argument lists.

Repo config is authoritative: edit `zitadel.json` or files under `.zitadel/`,
then re-run `deploy`. See the reference below for driving the login UI
and the config-sync details. The editor schemas in `.zitadel/meta/` are
generated by the CLI, not config: never edit them. `doctor` warns when one is
missing or outdated (after an upgrade that changed a dialect), and
`doctor --fix` writes the current ones, unless the project pins a newer
`@zitadel/*` version (run that version's `doctor --fix`) or a symlink is on
the path; `deploy --dry-run` validates without them either way.
`deploy`, `preview` and `release create`, `--dry-run` included, check the
shape of `.zitadel/` locally before anything is written, and fail with
`E_VALIDATION` listing each problem by field and by the schema's or flow's
handle (a policy by its file). The server still applies its own release rules
when the build is submitted, such as handles being unique, so a passing dry run
does not promise the release is accepted.

An SPA's dev proxy (`vite.config.*`, Angular's `proxy.conf.cjs`) keeps the
app's session in a cookie of its own project, `zitadel_session_<project id>`
on `http://localhost` and `__Host-zitadel_session_<project id>` over https.
`doctor` fails (`managed-files`, `outdated managed config wiring`) on the
session-cookie hooks a CLI wrote before these names: the server no longer
reads the cookies they keep. `doctor --fix` replaces hooks that are as the CLI
wrote them; ones changed by hand must be updated by hand, which the failure
says. Browsers signed in before the change sign in again.

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
