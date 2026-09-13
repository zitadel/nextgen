# ADR 061: CLI Resource Commands

> **Status:** Accepted
> **Date:** 2026-09-14
> **Context:** [ADR 007](007-gitops-configuration-surface.md) left runtime resources to server APIs and the [CLI design overview](../design/cli/README.md) reserved "a planned one-shot imperative CLI surface" for them; this ADR is that surface
> **Relates to:** [ADR 004](004-agent-contract-and-agents-md.md), [ADR 027](027-cursor-based-pagination.md), [ADR 030](030-error-model-mapping-and-reporting.md), [ADR 031](031-openapi-querying.md), [ADR 035](035-configuration-environments.md), [ADR 036](036-api-credential-planes.md)

Reference documentation for the surface lives in
[`docs/design/cli/resource-commands.md`](../design/cli/resource-commands.md).
This ADR records the choices behind it and why the alternatives were rejected.

## Decision

### 1. Configuration stays declarative; runtime resources become imperative

A thing that belongs in git — branding, login flows, schemas — is edited as a
file and shipped through a release ([ADR 035](035-configuration-environments.md)).
A thing that is unbounded or owned by someone other than the developer — a
user, a session, an audit event — gets a command and is never tracked in
`.zitadel/`. Where a resource falls decides its interface, so the boundary is
the first thing this ADR fixes.

### 2. The grammar is `zitadel <resource> <verb> [id] [flags]`

Resource first, plural, then the verb. `zitadel users create`, not
`zitadel create user` and not `zitadel user create`.

- **Resource before verb** because it groups: everything about users is one
  `--help` page and one tab-completion prefix, and a new verb can never collide
  with a top-level command the way `zitadel create` eventually would. This is
  the `gh` / `kubectl` / `stripe` ordering; the verb-first ordering is `docker`'s
  pre-1.13 mistake, which `docker` itself moved away from.
- **Plural** because `list` returns many and the noun should not change number
  between `users list` and `users get`.
- **The id is a positional argument, not `--id`.** It is the object of the
  sentence and it is mandatory; a flag would imply it is optional. Exactly one
  id per invocation — bulk work composes through the shell (`xargs`) rather
  than through a repeatable flag, so partial failure is the shell's problem and
  not a new half-succeeded exit code.
- **Short flags are rationed.** Only unambiguous ones exist (`-a` for `--all`),
  and letters the conventions reserve are left alone: `-d` belongs to
  `--debug`, so `--data` has no short form. A short flag that means one thing
  here and another elsewhere is worse than no short flag.

### 3. Six resources, and verbs only where an endpoint already exists

| Resource | Verbs |
|---|---|
| `users` | `list` `get` `create` `update` `delete` |
| `teams` | `list` `get` `create` `update` `delete` |
| `grants` | `list` `get` `create` `delete` |
| `projects` | `list` `get` `update` |
| `sessions` | `list` `get` `revoke` |
| `events` | `list` `get` |

Gaps are the API's gaps. The CLI does not synthesise a missing verb out of
other calls, and it does not hide one that exists. A verb is named after what
the endpoint does: sessions are `revoke`d because that is the operation, and
`teams delete` reports `deactivated` because [ADR 024](024-user-team-lifecycle-ownership.md)
makes deletion a deactivation.

### 4. One registry, one generic factory

Every command is generated from a single descriptor table by a factory that
knows nothing about Zitadel. Adding a resource is a table entry; changing a
convention changes it everywhere at once. Hand-authoring a command file per
verb is not allowed — that is how surfaces drift, and it is the failure this
ADR exists to prevent.

### 5. Commands are registered from a table, not discovered from the filesystem

A generated command has no file, so oclif's directory-pattern discovery cannot
find it. The CLI uses oclif's explicit strategy instead: one exported `COMMANDS`
table naming every command, hand-written and generated alike, built from a
single bundle entry.

The cost is that adding a command file no longer registers it — the table has to
name it. That is accepted, because the alternative is two registration
mechanisms where a generated command is second-class, and because an explicit
table is greppable.

Generated commands must also keep their internals out of oclif's serialized
statics: the registry entry behind a command is held outside the class, so
`zitadel commands --json` and the published manifest describe the command rather
than the machinery behind it. An agent reading that output is the reason it
matters.

### 6. Body fields are flags, generated from the request schema

Every scalar, enum, and open-record field of the generated request schema
becomes a flag, so `--help` is the field reference and a wrong value is caught
before a request is made. Conventions:

- **`snake_case` on the wire becomes `--kebab-case` on the command line**
  (`principal_type` → `--principal-type`). One mechanical rule, so the flag is
  derivable from the API docs and vice versa.
- **`--data '{…}'` and `--file` stay**, because a nested object or an array
  cannot be a single flag. `--file -` reads stdin, and fails immediately when
  stdin is a terminal rather than waiting on input that is never coming. When both supply the same key, the flag wins: the
  more specific, later-typed thing overrides the blob.
- **An open record takes repeatable typed entries**: `key=value` is always a
  string, `key:=value` parses the value as JSON. This is HTTPie's split, chosen
  because guessing loses either way — bare inference turns a postal code into a
  number, and no inference makes a customer's numeric schema field unsettable.
- **Required is enforced locally.** A missing required field names the field
  rather than round-tripping to a 400.

### 7. One call describes the whole surface

`zitadel resources [--json]` reports every resource, its verbs, its columns, its
`filter_fields` and `sort_fields`, its `create_fields` and `update_fields` with
each flag's name, kind and whether it is required, and its `delete_outcome`. It
contacts no server and needs no credential.

An agent that has to discover the surface by scraping `--help` is parsing prose
we reformat at will. This is the machine-readable alternative, and it is the
thing agents are told to read first — so anything an agent must know to drive a
command belongs here, not only in help text. `delete_outcome` is the worked
example: an agent has to learn that `teams delete` reports `deactivated` rather
than `deleted`, and help text alone could not tell it that.

### 8. The CLI suggests runnable commands, not raw tokens

Any result that has an obvious next step carries `next_commands`, and each entry
is a complete invocation that runs as typed — not a fragment and not a bare
value the caller has to splice.

A paged list repeats the whole original invocation with `--page-token` appended
and the token shell-quoted, so every filter, sort and limit survives the hop;
`--all` suggests nothing because it already drained. A refused deletion carries
the same command with `--force`. Handing back a bare `next_page_token` and
expecting the caller to rebuild the command is how a paging loop silently drops
a filter on page two.

### 9. `--json` is the contract; human output adapts to the terminal

`--json` emits the standard envelope (`status`, `data`, and on failure `code`,
`message`, `hint`, `next_commands`) and nothing else, so `jq` is the intended
consumer and never has to strip a banner.

Human output is chosen by the terminal, not by a flag the user must remember:
a list renders as an aligned table on a TTY and as tab-separated records when
piped or given `--plain`, so `awk` and `cut` work without column noise, and a
`get` renders as a labelled record.

Reading one record is `get`, and there is no `view`. `gh` splits the two —
`view` for people, `--json` for machines — but our commands already switch shape
on the terminal, so a second verb would make reading a record the one operation
where the human and machine forms are different commands. `get` renders the
labelled layout on a TTY and the raw object otherwise.

Each resource declares its default columns, and they are chosen so a human can
act on a row: an identifier they recognise, not an opaque id and two
timestamps. `--fields` overrides them. Columns hide nothing — `--json` always
returns the complete object — but the piped tab-separated form uses the same
list, so a bad column choice degrades scripts as well as tables. Its legal values come from the generated response
schema rather than from whatever the current page happened to return, so the
same argument gets the same answer on an empty project as on a full one, and
the check runs before any request. A field whose keys are the customer's rather
than the API's — a user's `attributes` — validates as a prefix, so
`attributes.anything` is accepted while `atributes.email` is caught as a typo. Progress output is suppressed when stdout
is not a terminal rather than redirected to stderr, because a spinner in a log
file is noise either way.

### 10. Destructive verbs confirm; `--force` is per command, never global

On a terminal, `delete` and `revoke` prompt. Non-interactively they require
`--force`, and refusing without it is an error carrying the exact command to
re-run. `--force` is declared by each command that honours it rather than
inherited globally, because what it permits differs — overwrite a managed file,
destroy a resource — and a global flag would let a habit formed on the harmless
one carry into the destructive one. `--dry-run` and `--non-interactive` / `-n`
are global, since their meaning does not change per command.

Declining the prompt is `status: "skipped"`, not an error: the user did what
the prompt asked, and a non-zero exit would make a cancelled confirmation
indistinguishable from a failed deletion in a script. The endpoints answer 204
with no body, so success echoes the id beside an outcome property —
`deleted`, `revoked`, or `deactivated` — rather than inventing a resource the
server did not return.

### 11. Paging, filtering, and sorting follow the API's own model

`--limit` / `--page-token` / `--all` expose cursor pagination directly
([ADR 027](027-cursor-based-pagination.md)) rather than inventing page numbers
the server does not have; `--all` drains pages client-side and is the only
place the CLI loops, so it stops with an error if a cursor repeats — an
unbounded follow of a server-supplied token is a hang wearing a progress
spinner. `--filter field=operation:value` is repeatable and
combines with AND, matching the structured query endpoints
([ADR 031](031-openapi-querying.md)); the operation defaults to `equals` so the
common case stays short. `--sort field:direction` takes one key, because the
endpoints accept one. Unknown fields are rejected locally with a near-miss
suggestion.

### 12. Credentials never reach a command line

No flag, argument, or record entry may carry one; the operator credential is
read from `.zitadel/secret` ([ADR 036](036-api-credential-planes.md)). Shell
history and process listings are readable by other users, so this is enforced
in code rather than documented as advice.

The refusal matches on the *name* — a record key that reads like a credential
(`password`, `client_secret`, `userToken`) is rejected, pointing the user at
`--data`, `--file`, or stdin. A name heuristic is a weak test, and it is
deliberately the weaker half of a pair: credentials are not user attributes at
all ([ADR 020](020-credentials-out-of-user-schema.md)), so anything it catches
was already a mistake. Detecting this from the schema instead is not possible
today — the meta-schema has no way to mark a property sensitive — and adding
one is a backend decision, not a CLI one.

### 13. The command surface follows the API, not the reverse

Where the CLI looks inconsistent because an endpoint is inconsistent — `events`
reads through `GET` while every other list uses `POST /<resource>/query` — the
CLI mirrors the deviation and the API is what gets fixed. A CLI that papers
over the shape teaches a shape that is not real.

### 14. Four facts are frozen for agents

The `--json` envelope shape, the exit codes, the error codes
([ADR 030](030-error-model-mapping-and-reporting.md)), and the cursor field
names are what agents parse ([ADR 004](004-agent-contract-and-agents-md.md)).
Changing any of them is a breaking change even though no type signature moves.

## Context

The CLI could already describe configuration but could not create a user. Every
workaround was `curl` against an endpoint whose auth, pagination, and error
shape the developer had to rediscover — so the knowledge lived in shell history
instead of in a tool. The open question was never whether to add these commands
but how much of the interface would be decided per resource, which is what
makes a CLI surface diverge from the API it fronts.

## Non-goals

IdP and app management stay experimental under
[ADR 007](007-gitops-configuration-surface.md): their server contracts are not
real yet, and neither is in the registry. This ADR does not change that.

Conventions that belong to the whole CLI rather than to this surface are out of
scope and deferred: `-h` not working, the absence of `--quiet`, the
`--no-input` spelling, `-n`'s collision with the conventional "dry run", weak
typo suggestions on unknown commands, no network timeout, and no pager. They
are real, but fixing them here would mean changing commands this surface does
not own.

## Open questions for the API

These are the places where the CLI surfaced something the API should decide.
Recorded here because §12 makes them the API's problem, not the CLI's:

- `events` reads through `GET` with query parameters while every other list uses
  `POST /<resource>/query`. Either the deviation is intended and should be
  written down, or events should move.
- Three filter operations are advertised by the query contract but answer 501.
  The CLI offers them because the contract does; today they fail at runtime.
- `users` cannot be filtered by email, which is the field a human most often
  has in hand.
- Grants have no update endpoint, so a grant is changed by deleting and
  recreating it.
- The meta-schema cannot mark a property sensitive, which is what keeps the
  credential guard a name heuristic (§11).

## Consequences

- The API's shape is now visible. A missing verb, an unimplemented filter, or
  an endpoint that deviates shows up as a CLI gap a user can see, which is a
  feature: it turns backend debt into something reported rather than absorbed.
- Column choices are product decisions sitting in a table with nothing
  asserting they are sensible. That is how `users` shipped a table keyed on a
  schema URL identical on every row instead of the person's email, and the same
  mistake is available to every resource added later.
- The registry is a choke point. A careless change to the factory changes every
  resource, so it carries the test weight to match.
- Flags are generated, so a field added to a request schema appears on the
  command line without a CLI change — and a field renamed there renames a flag,
  which is a breaking change the schema author has to notice.
- Conventions must be adopted, not re-invented: a new resource that wants its
  own pagination, flag spelling, or error shape is a signal the API is wrong,
  not the CLI.
