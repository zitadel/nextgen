# ADR 062: CLI Resource Commands

> **Status:** Proposed
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

### 3. Eleven resources, and verbs only where an endpoint already exists

| Resource | Verbs |
|---|---|
| `users` | `list` `get` `create` `update` `delete` |
| `teams` | `list` `get` `create` `update` `delete` |
| `grants` | `list` `get` `create` `delete` |
| `projects` | `list` `get` `update` |
| `sessions` | `list` `get` `delete` |
| `events` | `list` `get` |
| `schemas`, `environments`, `releases`, `flow-definitions`, `branding` | `list` `get` |

`environments` is spelled against an existing contract and needs resolving
before this lands: [ADR 035 §Inspection commands](035-configuration-environments.md)
is Accepted and specifies `zitadel env list`, while this registry produces
`zitadel environments list` and `zitadel environments get <name>`. Two spellings
for one thing is worse than either. Either this surface adopts `env`, or ADR 035
is amended to the plural — recorded below rather than decided here, because it
is a public command contract someone else already wrote down.

Configuration resources are readable but never writable here. They are authored
as files and shipped through a release (§1), so a write verb would be a second
writer over the same state — but reading what the server currently holds is how
you check that a deploy landed, and refusing that would be dogma rather than
design.

Elsewhere the verb set follows the endpoints. The CLI does not synthesise a
missing verb out of other calls, and it does not hide one that exists — with
two deliberate exceptions: `POST /projects` is unauthenticated bootstrap that
mints secrets into `.zitadel/secret`, which is `setup`'s job, and `POST
/sessions` mints an end-user session, which belongs to the SDKs and the login
flow rather than to a terminal. A verb is never renamed to describe what the
endpoint does with the resource. `DELETE /sessions/{id}` revokes and
`DELETE /teams/{id}` deactivates ([ADR 024](024-user-team-lifecycle-ownership.md)),
and both are `delete` on the command line: removal is spelled one way
everywhere, and what the server did is a property of the answer
(`deleted`, `revoked`, `deactivated`) rather than a different command to
learn.

### 4. One registry, one generic factory

Every command is generated from a single descriptor table by a factory that
knows nothing about Zitadel — including its wire vocabulary. The cursor
property names and the structured-query body shape are declared by the caller
and default to this API's (ADRs 027 and 031) rather than being written into the
factory, so "platform-agnostic" is a property a test can demonstrate rather
than a label. Adding a resource is a table entry; changing a
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

`--json` emits the standard envelope and nothing else, so `jq` is the intended
consumer and never has to strip a banner. The envelope is the one ADR 004
already defines — `cli_version`, `command` and `source` beside `status` and
`data`, plus `code`, `message`, `hint` and `next_commands` on failure — not a
shape this surface invents.

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

On a terminal, `delete` prompts. Non-interactively they require
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

### 11. One filter grammar, whatever the transport

Every list takes `--filter field=operation:value`, repeatable, and `--sort
field:direction` where the endpoint can sort. The caller writes the same thing
for `users` as for `events`, and the registry decides how it reaches the wire:
a structured query endpoint receives a validated filter body
([ADR 031](031-openapi-querying.md)), a `GET` list receives query parameters —
including an endpoint that spells one field's range as two parameters
(`created_after`, `created_before`) while the caller still writes
`created_at=greater_than_or_equal:…`.

**This abstracts the transport, not the capability.** Each field declares the
operations it actually accepts, so `--help` and `zitadel resources --json` name
them per field, and an operation a field does not declare is refused locally,
saying which field is the limitation. The CLI never silently drops a filter.

The limit of this is worth stating rather than glossing: the registry can only
declare what the *contract* says a field accepts. Three operations the query
contract advertises answer `501` today (below), so the CLI offers them and the
server refuses them. Local validation removes the class of failure the CLI can
see — a field or operation the contract does not have — not the class only the
server knows about. What it refuses to do
is make the caller learn a second grammar because the endpoint behind one
resource was written differently from the endpoint behind another.

Repeated uses of a field combine with AND, except where a field declares
otherwise — a repeated `GET` parameter widens rather than narrows, so that
field says so, and both the flag help and the discovery output repeat it.
Hiding that difference would change what a query means.

Paging is declared the same way: `--limit` / `--page-token` / `--all` expose
cursor pagination directly ([ADR 027](027-cursor-based-pagination.md)); a list
whose endpoint has no cursor declares itself unpaged and has no paging flags
rather than advertising ones the server ignores; and a list whose partial
answer would read as a complete one — a revision history — declares that a bare
invocation drains, with `--limit` or `--page-token` still returning one page.
`--all` is the only place the CLI loops, and it stops with an error if a cursor
repeats, since an unbounded follow of a server-supplied token is a hang wearing
a progress spinner.

### 12. Credentials never reach a command line

No flag, argument, or record entry may carry one; the operator credential is
read from `.zitadel/secret` ([ADR 036](036-api-credential-planes.md)). Shell
history and process listings are readable by other users, so this is enforced
in code rather than documented as advice.

The refusal matches on the *name*, against a wordlist hardcoded in the CLI:
`password`, `secret`, `token`, `credential`, and compounds like `apiKey`, split
across `snake_case`, `kebab-case` and `camelCase` so `client_secret` and
`userToken` match while `passwordless` does not.

**This is a stopgap and should be replaced by a schema-derived signal.** A
hardcoded list is wrong in both directions: it cannot know that a customer's
`recovery_phrase` is sensitive, and it will refuse an innocent field that
happens to contain the word `token`. The CLI is guessing at something the
schema is supposed to state.

The signal already half-exists. `writeOnly: true` is accepted on a user
property and reserved for a value that may be written but never read back, and
the OpenAPI documents use `format: password` in at least one place. Neither
reaches the CLI: nothing enforces `writeOnly` server-side today, and the
generated Zod schemas the commands introspect drop both keywords, so there is
nothing to read even where an author set them. Making this real means enforcing
`writeOnly` and carrying it (and `format`) through code generation — backend and
generator work, not a CLI change.

Until then the wordlist earns its place only as the weaker half of a pair:
credentials are not user attributes at all
([ADR 020](020-credentials-out-of-user-schema.md)), so anything it catches was
already a mistake.

### 13. The command surface follows the API, not the reverse

The line is between transport and meaning. How a filter travels — a query body
or a query parameter, one parameter or two — is plumbing, and §11 hides it so
the surface stays learnable. What a filter *can do* is meaning, and that is
never invented: an operation the endpoint lacks is refused, a verb it lacks is
absent, a field it cannot sort by gets no `--sort`.

So the six lists that read through `GET` — `events`, `schemas`,
`environments`, `releases`, `flow-definitions` and `branding` — while the other
five use `POST /<resource>/query` are smoothed over in the spelling and recorded
as an open question for the API. A majority of the collections deviate, which
makes it the prevailing shape rather than an exception. A CLI that papers over a *capability* teaches
a shape that is not real; one that papers over a *calling convention* spares
its users someone else's history.

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

- Six of the eleven collections read through `GET` with query parameters
  (`events`, `schemas`, `environments`, `releases`, `flow-definitions`,
  `branding`) while five use `POST /<resource>/query`. The CLI
  hides the difference (§11), but these endpoints accept only `equals`, sort by
  at most one implicit field, and spell a range as two parameters — so the
  capability gap is real even where the spelling is not. Either the deviation
  is intended and should be written down, or these should move.
- `zitadel environments list` versus ADR 035's `zitadel env list` (§3). The
  accepted ADR names the command; this one produces a different spelling for
  the same data. It needs one owner's decision, not two documents.
- `GET /releases` answered 500 on a project with no releases, on the prebuilt
  server this branch was tested against. It may already be fixed; it is
  recorded because the CLI is how it was noticed.
- Three filter operations are advertised by the query contract but answer 501.
  The CLI offers them because the contract does, so they fail at the server
  rather than locally — the one place §11's "nothing `--help` offers can fail"
  does not hold. Either implement them or remove them from the contract, and
  the CLI stops offering them automatically.
- `users` cannot be filtered by email, which is the field a human most often
  has in hand.
- Grants have no update endpoint, so a grant is changed by deleting and
  recreating it.
- `GET /branding` is the only list with no cursor at all, and answers with a
  bare array rather than the `{ items, next_page_token }` envelope every other
  list uses.
- Sensitivity is not carried end to end. `writeOnly` is accepted and reserved
  on a user property but unenforced, `format: password` appears in the OpenAPI
  documents, and code generation drops both — so the CLI cannot derive what is
  secret and falls back to a hardcoded wordlist (§12). Enforcing `writeOnly`
  and preserving it through generation would let the guard be exact.

## Consequences

- The API's shape is now visible. A missing verb, an unimplemented filter, or
  an endpoint that deviates shows up as a CLI gap a user can see, which is a
  feature: it turns backend debt into something reported rather than absorbed.
- The registry is hand-maintained, so an endpoint the API gains reaches nobody
  until someone adds an entry. A coverage test closes that: it reads the
  generated client, records which operations the registry's verbs actually
  invoke, and fails unless every operation the client offers is either called
  or listed with a written reason. Deciding not to expose something stays
  allowed; leaving it unnoticed does not.
- Whether something is a resource at all is mostly a judgement, but not
  entirely: a collection with `POST /<collection>/query` is one by the API's
  own definition ([ADR 031](031-openapi-querying.md)), so the test requires
  commands for it and accepts no exclusion. That covers five of the eleven
  today. The other six list through `GET` — the deviation recorded below — so
  until that is resolved, a new collection without a query endpoint still needs
  a person to classify it.
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
