# ADR 064: CLI Resource Commands

> **Status:** Proposed
> **Date:** 2026-09-14
> **Context:** [ADR 007](007-gitops-configuration-surface.md) left runtime resources to server APIs and the [CLI design overview](../design/cli/README.md) reserved "a planned one-shot imperative CLI surface" for them; this ADR is that surface
> **Relates to:** [ADR 004](004-agent-contract-and-agents-md.md), [ADR 027](027-cursor-based-pagination.md), [ADR 030](030-error-model-mapping-and-reporting.md), [ADR 031](031-openapi-querying.md), [ADR 035](035-configuration-environments.md), [ADR 036](036-api-credential-planes.md)

Reference documentation for the surface lives in
[`docs/design/cli/resource-commands.md`](../design/cli/resource-commands.md).
This ADR records the choices behind it and why the alternatives were rejected.

## Decision

### 1. Configuration stays declarative; runtime resources become imperative

A thing that belongs in git is edited as a file and shipped through a release
([ADR 035](035-configuration-environments.md)). Branding, login flows and
schemas are all of that kind. A thing that is unbounded, or owned by someone
other than the developer, gets a command and is never tracked in `.zitadel/`. A
user, a session and an audit event are all of that kind. Where a resource falls
decides its interface, so the boundary is the first thing this ADR fixes.

This describes the eleven resources here, not a law for everything that comes
later. A resource can legitimately need both paths. A customer-managed SSO
connection might be configuration when the developer owns it, and an API
resource when the customer does. That case should be decided on its own merits
rather than by this rule.

### 2. The grammar is `zitadel <resource> <verb> [id] [flags]`

Resource first, plural, then the verb. `zitadel users create`, not `zitadel
create user` and not `zitadel user create`.

- **Resource before verb** because it groups: everything about users is one
  `--help` page and one tab-completion prefix, and a new verb can never collide
  with a top-level command the way `zitadel create` eventually would. This is
  the `gh` / `kubectl` / `stripe` ordering; the verb-first ordering is
  `docker`'s pre-1.13 mistake, which `docker` itself moved away from.
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
| `teams` | `list` `get` `create` `update` `deactivate` |
| `grants` | `list` `get` `create` `delete` |
| `idps` | `list` `get` `create` |
| `projects` | `list` `get` `update` |
| `sessions` | `list` `get` `revoke` |
| `events` | `list` `get` |
| `schemas`, `environments`, `releases`, `flow-definitions`, `branding` | `list` `get` |

`environments` is spelled against an existing contract and needs resolving
before this lands. [ADR 035 §Inspection
commands](035-configuration-environments.md) is Accepted and specifies `zitadel
env list`. This surface produces `zitadel environments list` and `zitadel
environments get <name>`. Two spellings for one thing is worse than either.
Either this surface adopts `env`, or ADR 035 is amended to the plural —
recorded below rather than decided here, because it is a public command
contract someone else already wrote down.

Configuration resources are readable but never writable here. They are authored
as files and shipped through a release (§1), so a write verb would be a second
writer over the same state. Reading is different. Seeing what the server
currently holds is how you check that a deploy landed, and refusing that would
be dogma rather than design.

Elsewhere the verb set follows the endpoints. The CLI does not synthesise a
missing verb out of other calls, and it does not hide one that exists. There
are two deliberate exceptions. `POST /projects` is unauthenticated bootstrap
that mints secrets into `.zitadel/secret`, which is `setup`'s job. `POST
/sessions` mints an end-user session, which belongs to the SDKs and the login
flow rather than to a terminal. `delete` means the resource is gone. An
operation that changes a resource's state while leaving it readable is named
after what it does. `DELETE /sessions/{id}` terminates a session, so the
command is `revoke`. `DELETE /teams/{id}` deactivates a team that stays
readable ([ADR 024](024-user-team-lifecycle-ownership.md)), so the command is
`deactivate`.

This follows `gh`, which is strict about the word rather than about uniformity.
Secrets, keys and labels are `delete`d. A pull request is `close`d, `lock`ed or
`merge`d, and `gh pr delete` does not exist at all. Spelling a deactivation
`delete` would tell someone their team is gone when it is still there, and no
amount of consistency is worth that. The result still reports what happened
beside the id (`deleted`, `revoked`, `deactivated`), so an agent reads the
outcome rather than inferring it from the verb.

### 4. One registry, one generic factory

Every command is generated from a single descriptor table by machinery that
knows nothing about Zitadel. Even the API's own conventions, such as how a
cursor is named, are declared by the table rather than assumed, so
"platform-agnostic" is something a test can demonstrate rather than a label.
Adding a resource is a table entry; changing a convention changes it everywhere
at once. Hand-authoring a command file per verb is not allowed — that is how
surfaces drift, and it is the failure this ADR exists to prevent.

### 5. The generated surface is described, not discovered

Whatever a command is built from, what it *offers* is published: `zitadel
commands --json` and `zitadel resources --json` describe the commands, their
flags and their fields, and nothing about how they were produced. Agents read
that output, so it is part of the contract rather than a by-product.

How commands are registered with the framework is an implementation matter and
lives in
[`docs/design/cli/resource-commands.md`](../design/cli/resource-commands.md).

### 6. Body fields are flags, generated from the request schema

Every scalar, enum, and open-record field of the generated request schema
becomes a flag, so `--help` is the field reference and a wrong value is caught
before a request is made. Conventions:

- **`snake_case` on the wire becomes `--kebab-case` on the command line**
  (`principal_type` → `--principal-type`). One mechanical rule, so the flag is
  derivable from the API docs and vice versa.
- **`--data '{…}'` and `--file` stay**, because a nested object or an array
  cannot be a single flag. `--file -` reads stdin, and fails immediately when
  stdin is a terminal rather than waiting on input that is never coming. When
  both supply the same key, the flag wins: the more specific, later-typed thing
  overrides the blob.
- **An open record takes repeatable typed entries**: `key=value` is always a
  string, `key:=value` parses the value as JSON. This is HTTPie's split, chosen
  because guessing loses either way — bare inference turns a postal code into a
  number, and no inference makes a customer's numeric schema field unsettable.
- **Required is enforced locally.** A missing required field names the field
  rather than round-tripping to a 400.

### 7. One call describes the whole surface

`zitadel resources [--json]` reports every resource, its verbs, its columns,
its `filter_fields` and `sort_fields`, its `create_fields` and `update_fields`
with each flag's name, kind and whether it is required, and its
`delete_outcome`. It contacts no server and needs no credential.

An agent that has to discover the surface by scraping `--help` is parsing prose
we reformat at will. This is the machine-readable alternative, and it is the
thing agents are told to read first — so anything an agent must know to drive a
command belongs here, not only in help text. `delete_outcome` is the worked
example: an agent has to learn that `teams delete` reports `deactivated` rather
than `deleted`, and help text alone could not tell it that.

### 8. The CLI suggests runnable commands, not raw tokens

Any result that has an obvious next step carries `next_commands`, and each
entry is a complete invocation that runs as typed — not a fragment and not a
bare value the caller has to splice.

A paged list repeats the whole original invocation with `--page-token` appended
and the token shell-quoted, so every filter, sort and limit survives the hop;
`--all` suggests nothing because it already drained. A refused deletion carries
the same command with `--force`. Handing back a bare `next_page_token` and
expecting the caller to rebuild the command is how a paging loop silently drops
a filter on page two.

### 9. `--json` is the contract; human output adapts to the terminal

`--json` emits the standard envelope and nothing else, so `jq` is the intended
consumer and never has to strip a banner. The envelope is the one ADR 004
already defines, not a shape this surface invents. It carries `cli_version`,
`command` and `source` beside `status` and `data`, plus `code`, `message`,
`hint` and `next_commands` on failure.

Human output is chosen by the terminal, not by a flag the user must remember. A
list renders as an aligned table on a TTY, and as tab-separated records when
piped or given `--plain`, so `awk` and `cut` work without column noise. A `get`
renders as a labelled record.

Reading one record is `get`, and there is no `view`. `gh` splits the two, with
`view` for people and `--json` for machines. Our commands already switch shape
on the terminal. A second verb would make reading a record the one operation
where the human and machine forms are different commands. `get` renders the
labelled layout on a TTY and the raw object otherwise.

Each resource declares its default columns, and they are chosen so a human can
act on a row: an identifier they recognise, not an opaque id and two
timestamps. `--fields` overrides them. Columns hide nothing, because `--json`
always returns the complete object. The piped tab-separated form uses the same
list though, so a bad column choice degrades scripts as well as tables. Its
legal values come from the generated response schema, not from whatever the
current page happened to return. So the same argument gets the same answer on
an empty project as on a full one, and the check runs before any request. Some
fields have keys the customer chooses rather than the API, such as a user's
`attributes`. Those validate as a prefix, so `attributes.anything` is accepted
while `atributes.email` is caught as a typo. Progress output is suppressed when
stdout is not a terminal rather than redirected to stderr, because a spinner in
a log file is noise either way.

### 10. Destructive verbs confirm; `--force` is per command, never global

On a terminal, a destructive verb prompts. Non-interactively they require
`--force`, and refusing without it is an error carrying the exact command to
re-run. Each command that honours `--force` declares its own, rather than
inheriting one. What it permits differs: on `setup` it overwrites a managed
file, on a destructive verb it destroys a resource. A single global flag would
let a habit formed on the harmless one carry into the destructive one.
`--dry-run` and `--non-interactive` / `-n` are global, since their meaning does
not change per command.

Declining the prompt is `status: "skipped"`, not an error: the user did what
the prompt asked, and a non-zero exit would make a cancelled confirmation
indistinguishable from a failed deletion in a script. The endpoints answer 204
with no body. Success therefore echoes the id beside an outcome property,
either `deleted`, `revoked` or `deactivated`, rather than inventing a resource
the server did not return.

### 11. One filter grammar, whatever the transport

Every list takes `--filter field=operation:value`, repeatable, and `--sort
field:direction` where the endpoint can sort. The caller writes the same thing
for `users` as for `events`. The registry decides how it reaches the wire. A
structured query endpoint receives a validated filter body ([ADR
031](031-openapi-querying.md)). A `GET` list receives query parameters,
including the case where one field's range is two separate parameters
(`created_after` and `created_before`) while the caller still writes
`created_at=greater_than_or_equal:…`.

**This abstracts the transport, not the capability.** Each field declares the
operations it actually accepts, so `--help` and `zitadel resources --json` name
them per field, and an operation a field does not declare is refused locally,
saying which field is the limitation. The CLI never silently drops a filter.

The limit of this is worth stating rather than glossing: the registry can only
declare what the *contract* says a field accepts. Three operations the query
contract advertises answer `501` today (below), so the CLI offers them and the
server refuses them. Local validation removes the failures the CLI can see,
meaning a field or operation the contract does not have. It cannot remove the
ones only the server knows about. What it refuses to do is make the caller
learn a second grammar because the endpoint behind one resource was written
differently from the endpoint behind another.

Repeated uses of a field combine with AND, except where a field declares
otherwise. A repeated `GET` parameter widens rather than narrows, so that field
says so, and both the flag help and the discovery output repeat it. Hiding that
difference would change what a query means.

Paging is declared the same way. `--limit`, `--page-token` and `--all` expose
cursor pagination directly ([ADR 027](027-cursor-based-pagination.md)). A list
whose endpoint has no cursor declares itself unpaged, so it has no paging flags
at all rather than advertising ones the server ignores. A filter field can also declare the value sent when the
caller does not name it. That is how a revisioned collection lists the current
revisions rather than its whole history: naming the field always wins, so the
history stays one filter away. `--all` is the only place the CLI loops, and it
stops with an error if a cursor repeats, since an unbounded follow of a
server-supplied token is a hang wearing a progress spinner.

### 12. A resource is addressed by whatever identifies it

`get` takes whatever names the thing. Usually that is an id. An environment is
addressed by its name. A revisioned resource is addressed either by one
revision or by the value that groups them, so `zitadel schemas get human-user`
returns the current revision of that object type and `zitadel schemas get
sch_07` returns exactly that one.

Where the API has a route for it this costs nothing. `environments get` calls
`/environments/{name}` and the registry simply says so. Where it does not, the
resource resolves the reference itself with one filtered list, and that
resolution lives in the resource's own entry rather than in the generic
machinery. It is a workaround. It decides from the shape of the argument which
kind of reference it was given, which is a rule the server never promised.

[ADR 063](063-resource-revisions-fixed-id-and-revision-id.md) is the end of
it. If accepted, every revisioned resource gets a fixed `id` shared by all its
revisions plus a `revision_id` per revision, `GET /<kind>/{id}` returns the
newest revision, and the list drops its `revisions` parameter because it
returns each resource once. At that point the CLI's guessing goes away: `get`
takes the fixed id and needs no rule about id shapes, and the
`revisions: latest` defaults below are deleted rather than reconfigured. Until
those routes exist, the CLI matches the API it has.

### 13. Credentials never reach a command line

No flag, argument, or record entry may carry one; the operator credential is
read from `.zitadel/secret` ([ADR 036](036-api-credential-planes.md)). Shell
history and process listings are readable by other users, so this is enforced
in code rather than documented as advice.

The refusal matches on the field's *name*, against a list of credential words
held in the CLI. It recognises the obvious ones in any spelling, so
`client_secret` and `userToken` are refused while `passwordless` is not.

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
`writeOnly` and carrying it (and `format`) through code generation — backend
and generator work, not a CLI change.

Until then the wordlist earns its place only as the weaker half of a pair:
credentials are not user attributes at all ([ADR
020](020-credentials-out-of-user-schema.md)), so anything it catches was
already a mistake.

### 14. The command surface follows the API, not the reverse

The line is between transport and meaning. How a filter travels is plumbing: a
query body or a query parameter, one parameter or two. §11 hides that so the
surface stays learnable. What a filter *can do* is meaning, and that is never
invented: an operation the endpoint lacks is refused, a verb it lacks is
absent, a field it cannot sort by gets no `--sort`.

Six lists read through `GET`, and five use `POST /<resource>/query`. The six
are `events`, `schemas`, `environments`, `releases`, `flow-definitions` and
`branding`. That is the contract, not drift: [ADR 031](031-openapi-querying.md)
allows `GET` alongside the query endpoint and says plainly that it "won't have
filter/sort functionality". Those six genuinely have less capability, and the
CLI reports exactly that. They get fewer operations per field, and no `--sort`
where the endpoint cannot sort. What they *can* do is spelled the same way as
everything else. Whether any of them should gain `/query` is a question about
who needs to filter them, not a defect to fix.

### 15. Four facts are frozen for agents

The `--json` envelope shape, the exit codes, the error codes ([ADR
030](030-error-model-mapping-and-reporting.md)), and the cursor field names are
what agents parse ([ADR 004](004-agent-contract-and-agents-md.md)). Changing
any of them is a breaking change even though no type signature moves.

## Context

The CLI could already describe configuration but could not create a user. Every
workaround was `curl` against an endpoint whose auth, pagination, and error
shape the developer had to rediscover — so the knowledge lived in shell history
instead of in a tool. The open question was never whether to add these commands
but how much of the interface would be decided per resource, which is what
makes a CLI surface diverge from the API it fronts.

## Non-goals

App management stays experimental under [ADR
007](007-gitops-configuration-surface.md): its server contract is not real yet,
and it is not in the registry. Identity provider connections are no longer in
that position — #1217 defines the contract, so `idps` is a resource here like
any other, and ADR 007's experimental note no longer covers it.

The revision routes those connections carry
([ADR 063](063-resource-revisions-fixed-id-and-revision-id.md)) are out of
scope. `GET /idps/{id}/revisions` is a listing under one resource, and the
grammar has no verb for that. Inventing one for a single resource is what §4
rules out, so the shape needs deciding before any resource gets it.

Conventions that belong to the whole CLI rather than to this surface are out of
scope and deferred. Those are `-h` not working, the absence of `--quiet`, the
`--no-input` spelling, `-n`'s collision with the conventional "dry run", weak
typo suggestions on unknown commands, no network timeout, and no pager. They
are real, but fixing them here would mean changing commands this surface does
not own.

## Open questions for the API

These are the places where the CLI surfaced something the API should decide.
Recorded here because §14 makes them the API's problem, not the CLI's:

- Six collections list through `GET` only, so they cannot be filtered beyond
  `equals` and cannot be sorted ([ADR 031](031-openapi-querying.md) permits
  exactly this). Not a defect, but worth revisiting per resource as use cases
  appear; `users` by email below is the concrete one today.
- No endpoint fetches a schema by object type or a flow by name, so §12
  resolves those with a filtered list and a rule about how ids look.
  [ADR 063](063-resource-revisions-fixed-id-and-revision-id.md) resolves this
  properly if accepted; it also says the `revisions` parameter this surface
  relies on is removed once the revision routes exist, so the defaults below
  are temporary by design rather than by neglect.
- Variables ([ADR 062](062-per-environment-variables-and-secrets.md)) are a
  management resource this surface does not cover. A variable has no id, the
  list is a map keyed by name rather than rows, and the write is one merge over
  the whole map where `null` removes. Commands for them would need an upsert
  verb and map rendering, which is a shape decision rather than a registry
  entry — `gh variable set` is the shape to copy if we want it.
- `zitadel environments list` versus ADR 035's `zitadel env list` (§3). The
  accepted ADR names the command; this one produces a different spelling for
  the same data. It needs one owner's decision, not two documents.
- Three filter operations are advertised by the query contract but answer 501.
  The CLI offers them because the contract does, so they fail at the server
  rather than locally — the one place §11's "nothing `--help` offers can fail"
  does not hold. Either implement them or remove them from the contract, and
  the CLI stops offering them automatically.
- `users` cannot be filtered by email. Not an oversight: email lives in the
  user's `attributes`, which the project's own schema defines, and search over
  schema-defined attributes is not supported yet. It is worth naming because
  email is the field a human most often has in hand, so this is the case most
  likely to force attribute search.
- Grants have no update endpoint, so a grant is changed by deleting and
  recreating it.
- `GET /branding` is the only list with no cursor at all, and answers with a
  bare array rather than the `{ items, next_page_token }` envelope every other
  list uses.
- Sensitivity is not carried end to end. `writeOnly` is accepted and reserved
  on a user property but unenforced, `format: password` appears in the OpenAPI
  documents, and code generation drops both — so the CLI cannot derive what is
  secret and falls back to a hardcoded wordlist (§13). Enforcing `writeOnly`
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
  today. A `GET`-only collection is equally legitimate under ADR 031, so the
  absence of a query endpoint proves nothing either way and a new collection
  still needs a person to classify it.
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
