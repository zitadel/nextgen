---
name: zitadel-cli
description: >-
  Set up and manage Zitadel authentication in a local project with the
  agent-friendly `zitadel` CLI. Use when the user wants to add login,
  registration, or session handling, create a Zitadel project, scaffold auth
  for a Next.js, Nuxt, SvelteKit, SolidStart, Qwik Router, TanStack Start, React,
  Vue, Angular, Solid, Svelte, or Qwik app, or plan and apply Zitadel config
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
  just what you need (e.g. `… resources --json | jq '.data.resources[].name'`).
  `--help` output is bounded too — read it in full rather than `head`-ing it, or
  you will miss flags further down.
- **Working directory.** Add `--cwd <path>` when operating outside the current
  working directory.
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
  often simplest.
- **Calling an operation no command covers.** `zitadel api <operation>` calls
  any operation of the API with the resolved server and `.zitadel/secret`.
  Name it by its `operationId` (`queryUsers`, as the API reference and
  `@zitadel/api` spell it) or by its path (`/users/query`; `-X` picks the
  method where a path has several). Path parameters follow as arguments, in
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
are not certain of, run `zitadel --help` first and use the exact name it prints:
command and resource names — including whether a resource is singular or plural
and the exact verb — are whatever `--help` shows, never what you would assume. A
wrong guess costs a failed call and a round of recovery; one cheap `--help` up
front avoids it. `zitadel --help` is a flat list and cheap to read, so reach for
it first; treat the CLI's own output as authoritative over anything you remember:

```sh
npx @zitadel/cli@latest --help               # every command, grouped by purpose
npx @zitadel/cli@latest commands             # flat list of all commands
npx @zitadel/cli@latest <command> --help     # a command's flags, which are required, and examples
npx @zitadel/cli@latest resources --json     # the resource surface in one call (see below); contacts no server
npx @zitadel/cli@latest api ls --json        # every API operation, its parameters, body and paging; contacts no server
```

`--help` groups the surface into project commands (create a project and scaffold
auth), local-server commands (run a local Zitadel), configuration commands
(`plan`/`apply` plus the config resources), and resource commands (the uniform
`<resource> <verb>` surface). Read the groups from `--help` rather than from
memory, since they change as the CLI gains commands.

Use `zitadel --help` to find *which* command to run. Use `resources --json` when
you need a resource's *fields*: it reports the whole runtime-resource surface at
once — every resource, its verbs, each verb's `create_fields` / `update_fields`
(flag name, kind, `required`, any closed value set), its `filter_fields` /
`sort_fields`, and the `delete_outcome` a destructive verb returns — so prefer it
over reading `<resource> --help` one at a time. A `list` verb's envelope carries
`data.count`, the number of items it returned. A list returns one page unless
you pass `--all`, so a "how many …?" question is one `list --all --json` call:
read the count, do not page and tally.

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
- `plan` and `apply` emit `data.changes`: one row per touched resource
  (`{kind, action, file, id?, previous_id?, moved_from?}`, action ∈ create/
  update/revision/delete/move). A `move` is a file that took over a resource
  from a removed one (`moved_from`). Plan rows preview; apply rows report, with
  the resulting platform ids. Use it to verify an edit did what you intended.
  `data.unsupported_deletions` counts removed files whose resource cannot be
  deleted yet (they are kept, and are not part of `total`); on `apply` the files
  are listed in `data.unsupported_deletion_files`.
- `apply` leaves the files under `.zitadel/` as written: what the server stores
  is never written back, and a field a file leaves out reads as the server's
  default, so `plan` reports no change after an `apply`. `data.files_updated`
  lists the one rewrite: a flow whose `user_schema` pinned a schema revision id
  the apply superseded, re-pinned to the new revision's id.
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
  with `variables set NAME --project-level` (add `--secret` for the secret), then retry.
- `E_LOCAL_SERVER_NOT_RUNNING`: start the local runtime, then retry with
  `--server local`.
- `E_NOT_FOUND`: an HTTP 404 — a missing resource, an operation the server's
  version does not have (`details.body.code` is `req.not_found`), or a
  `--server` that is not a Zitadel platform API. Follow `next_commands`.
- `E_PORT_IN_USE`: the requested local runtime port already has a listener; stop
  that process or choose another port.

In human mode the output follows the terminal (TTY table, or tab-separated lines
when piped or `--plain`); `--json` is unaffected and remains the contract.

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
130: a command waiting on the server stops at once with `E_CANCELLED`, and
any other command exits within a second, possibly without an envelope. An
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
  `.zitadel/schemas/*.json`, then `apply`.

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
flags, `--json`, the `plan`/`apply` split, exit codes, and the number of
commands you ran are your internal business; the user asked for an outcome, not
a transcript. Say what they got.

- Good: "Added an optional phone number to your user schema and deployed it."
- Avoid: "I ran `plan` and `apply`, both with `--non-interactive --json`, and
  both returned ok."

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
npx @zitadel/cli@latest plan --non-interactive --json
npx @zitadel/cli@latest apply --non-interactive --json
```

`setup` scaffolds into an empty directory, or patches an existing app project
where it detects a framework. What `start` leaves in a directory —
`.zitadel/local/` and the `.gitignore` line that ignores it — still counts as
empty, so the golden path runs `setup` right after `start` in the same
directory. Any other non-empty directory stops setup with a hint to pass
`--force`. Pass it only for a directory whose contents may be replaced: files
the new app also has, such as `package.json`, are overwritten. Without a
terminal `setup` cannot ask which framework to scaffold, so pass `--framework`;
the error lists the choices in `details.frameworks`. `setup --dry-run` creates
no app: where it would scaffold one, it previews the project, and
`data.files_written` is empty, because those files depend on the generated app.
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
`doctor --json` returns the argument lists in `details.suggested_args` to run as they are). `stop`,
`reset` and `status` read only the working directory's
`.zitadel/local/`, so run them where `start` ran. On a local
server that hosts the platform project, `setup` attaches the project to the
local admin's team and ends `data.next_commands` with `console`; when it finds
no local admin for that server on the way up, it says so in the envelope's
`warnings` and the project stays unattached, so the local console does not
list it.

When `setup --sso` or `sso enable` adds a social sign-in provider, the user
must register the connection's redirect URI with the provider themselves: give
them `data.sso[].callback_uri` from `setup`, or `data.callback_uri` from
`sso enable`, verbatim. Each connection has its own URI, so a URI from another
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

To move a set-up app to another dev port (the dev server exits with
`EADDRINUSE`, or another app needs the port), run `setup --dev-port <port>` in
the app; never change the port in one file by hand. In a directory with a
`zitadel.json`, `setup` returns `status: "skipped"` with `reason:
"already-initialized"`, unless `--dev-port` is given: then it moves the app.
It allows the new origin on the server first, and a refusal changes nothing.
It then rewrites the dev script or dev-server config, `ZITADEL_ISSUER` in
`.env.local`, `zitadel.json`, `.zitadel/secret` and the README/AGENTS.md
guidance, and removes the old origin. `data.previous_issuer` and `data.issuer`
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
project. When they refuse, they write and publish nothing, on a dry run too.
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
when nothing changed. Follow `data.next_commands` (`plan`, `apply`, and
`variables set` when a credential did not reach the project) to publish the
change. When a path or schema name would need shell quoting, `next_commands` is
empty and `data.next_args` (or `details.suggested_args` on a refusal) holds the
same commands as argument lists.

After enabling a provider, `test sign-in` checks the setup without a browser. It
checks every connection the project has, one block each, and `--provider google`
checks just one: the provider's discovery document (and the endpoints the runtime needs
from it), the scopes and claims the connection asks for, and whether the provider accepts the client and the
callback URI. It never needs the client secret, which the platform stores
write-only. Each entry of `data.providers[].checks` has a `status` of `pass`,
`warn`, `fail` or `skipped`, and a `skipped` check is never a pass: it says the
check could not tell. A failure exits `E_VALIDATION` naming the providers that
failed, with the one thing to do in `hint`. The checks cannot prove a sign-in
works end to end: only a person signing in does.

Repo config is authoritative: edit `zitadel.json` or files under `.zitadel/`,
then re-run `plan` and `apply`. See the reference below for driving the login UI
and the config-sync details.

## Reference files

Load on demand:

- [`references/driving-login-ui.md`](references/driving-login-ui.md) — driving the
  `<zitadel-login>` component in a browser, and the authoritative repo-config
  workflow (schemas, flows, branding).
