# CLI Resource Commands

> **Status:** Proposed — eleven resources; see the table below. The decisions
> are [ADR 064](../../adrs/064-cli-resource-commands.md), the implementation is
> [#1210](https://github.com/zitadel/nextgen/pull/1210).
> **Context:** The imperative surface for runtime resources that
> [README.md](README.md#what-lives-in-zitadel-and-what-doesnt) reserves for
> data the developer does not own in git. Configuration resources are readable
> here but are written only by the declarative path — `deploy` under
> [ADR 035](../../adrs/035-configuration-environments.md), which replaces the
> `plan` / `apply` of [ADR 007](../../adrs/007-gitops-configuration-surface.md).

## Shape

Each runtime resource exposes the verbs its API supports — the table below says
which — and every verb that exists behaves the same way, with the same flags and
the same envelope. That uniformity is in how a verb works, not in which verbs a
resource has:

```
zitadel <resource> list    [--filter …] [--sort …] [--limit N] [--page-token T | --all]
zitadel <resource> get     <id>
zitadel <resource> create  [--<field> …] [--set <path>=<value> …] [--data '<json>' | --file <path|->]
zitadel <resource> update  <id> [--<field> …] [--set <path>=<value> …] [--data '<json>' | --file <path|->]
zitadel <resource> delete  <id> [--force]
```

The verbs are generated from one registry
(`apps/cli/src/commands/resources.ts`)
by a platform-agnostic factory
(`apps/cli/src/lib/oclif/crud/`).
The registry names the client call per verb, the id field, the table columns,
and the filterable and sortable fields. The factory owns everything below.
Adding a backend resource is adding a registry entry.

Runtime resources:

| Resource   | Verbs                             | Backing endpoints                                   |
| ---------- | --------------------------------- | --------------------------------------------------- |
| `users`    | list, get, create, update, delete | `POST /users/query`, `/users/{id}`                  |
| `teams`    | list, get, create, update, deactivate | `POST /teams/query`, `/teams/{id}`              |
| `sessions` | list, get, revoke                 | `POST /sessions/query`, `DELETE /sessions/{id}`     |
| `events`   | list, get                         | `GET /events`, `GET /events/{id}`                   |
| `grants`   | list, get, create, delete         | `POST /grants/query`, `/grants/{id}`                |
| `projects` | list, get, update                 | `POST /projects/query`, `/projects/{id}`            |

Configuration resources, read-only — they are authored as files and shipped
through a release, so the CLI reads them to show what the server currently
holds and never writes them here:

| Resource            | Verbs     | Backing endpoints                                    |
| ------------------- | --------- | ---------------------------------------------------- |
| `schemas`           | list, get | `GET /schemas`, `GET /schemas/{id}`                  |
| `releases`          | list, get | `GET /releases`, `GET /releases/{id}`                |
| `flow-definitions`  | list, get | `GET /flow_definitions`, `GET /flow_definitions/{id}` |
| `branding`          | list, get | `GET /branding`, `GET /branding/{id}`                |

Two of these behave differently underneath, and the registry says so rather
than the caller having to learn it. `schemas list` and `flow-definitions list` send
`revisions=latest`, so they show the current schemas and flows rather than
every revision ever written; `--filter revisions=all` gives the history. `branding list` has no paging
flags at all, because its endpoint has no cursor and answers with a bare array.

`schemas` and `flow-definitions` are also addressable by the value that groups
their revisions, so `schemas get human-user` returns the current revision of
that object type and `flow-definitions get default-login` the newest revision
of that flow. A prefixed id or a URI is still fetched directly. There is no
endpoint for either lookup yet, so each entry resolves the reference with one
filtered list of its own; see ADR 064 §12.

## Anatomy

Every verb is a class with the same two members, so the operations read alike:

| File                                      | Owns                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `crud/ops/command.ts`                     | `ResourceCommand` — parse, resolve meta, `execute`, emit; `bindOperation`, which holds each command's definition in a `WeakMap` beside the class rather than as a static, since oclif copies a command's own statics into `commands --json` and the published manifest |
| `crud/ops/list.ts`, `read.ts`, `write.ts`, `delete.ts` | One `*Operation` class each: static `describe()` → oclif statics, `execute()` → `CommandResult` |
| `crud/paging.ts`, `table.ts`, `body.ts`, `query.ts`, `fields.ts` | Pure helpers: cursor draining, table rendering, body loading, filter grammar, schema-to-flag generation |
| `crud/wire.ts`                            | The platform's cursor property names and structured-query body shape, defaulted to this API's and overridable by the caller |
| `crud/types.ts`                           | The registry contract, generic over the platform connection `Ctx`  |

`buildResourceCommands` binds each registry entry to its operation classes and
returns oclif command classes keyed by id (`users:list`).

## Discovery

`zitadel resources` answers, in one call, what an agent otherwise pieces
together from thirty-three `--help` invocations: which resources exist, the verbs each
exposes, what its list can filter and sort on, and the body fields of its
writes. It is a projection of the registry, talks to no server, and is the role
`stripe resources` and `kubectl api-resources` play in those CLIs.

```console
$ zitadel resources
resource  verbs                              filter on
--------  ---------------------------------  ---------------------------------------------
users     list, get, create, update, delete  created_at, id, schema, status, team_id, …
teams     list, get, create, update, deactivate  created_at, name, status
sessions  list, get, revoke                  created_at, user_id, state, …
```

`--json` also carries `delete_outcome`, the property a delete's envelope puts
beside `id` — `deleted`, `revoked`, or `deactivated` — so an agent need not
guess which. And it adds the write fields per verb — `create_fields` and `update_fields`,
each with its dot path (`name`), its flag (`null` when only `--set` reaches it),
kind, whether it is required, and any closed value set or default — so a create
can be assembled as flags, `--set` assignments or a document without guessing,
and an update is not described with the create's required fields. A resource
whose document sits under a root in the request reports it as
`document_root`.

## Credential and scope

Every verb sends the project secret as the bearer (operator plane,
[ADR 036](../../adrs/036-api-credential-planes.md)). The secret, the project and
the server come from the environment the command runs in, resolved like those of
every command that talks to a project: `--server`, `--env-file`, the process
environment, the `.env` files, then `.zitadel/secret`. Endpoints that take
`project_id` receive it from there; there is no project flag. `--env` and
`--env-file` choose the environment.

## Listing and pagination

- `list` returns **one page**. The server's default page size applies unless
  `--limit N` (1–100) is given. `branding` declares otherwise: it has no paging
  flags at all, because its endpoint has no cursor.
- A filter field may declare the value sent when the caller does not name it.
  `schemas` uses this for `revisions`, defaulting to `latest`; naming the field
  always wins, so `--filter revisions=all` still returns the history.
- `--page-token T` continues from a previous response; the token is opaque and
  is passed back verbatim.
- `--all` drains every page in order. It is exclusive with `--page-token`.
- While a page remains, the envelope also carries `data.next_commands` with a
  runnable next-page command. A cursor is only valid alongside the sorting and
  filters that issued it, so the suggestion repeats the whole invocation rather
  than handing back a bare token; `--all` suggests nothing, having drained
  everything.
- The envelope is identical for every resource:

  ```json
  { "cli_version": "…", "command": "users:list", "source": "…",
    "status": "ok", "data": { "items": [ … ], "count": 42, "next_page_token": "…" } }
  ```

  `next_page_token` is a string while more pages exist and `null` when the
  listing is complete or `--all` was used. Agents loop until it is `null`.
- `--fields id,attributes.email` chooses the columns, dot-paths included; the
  resource's own columns are the default, and `--json` is unaffected. The paths
  a record may carry are read from the generated response schema, so a typo is
  refused before any request and the verdict does not depend on how many records
  a page happened to return. An open record — a user's `attributes`, whose keys
  come from the project's user schema rather than the API spec — is reported as
  a prefix, so `attributes.<key>` is always accepted while a typo in a declared
  segment is not.
- Output follows the terminal. On a TTY a list is an aligned table of the
  registry's columns with a row count and, when a page remains, a hint carrying
  the next token. Piped or redirected — or with `--plain` — it is one
  tab-separated record per line, no header and no footer, so `cut -f2` and
  `awk -F'\t'` work. Tabs and newlines inside a value are escaped so a record
  never spans lines.
- `--all` shows a spinner while it drains, on a terminal only; a pipe gets no
  animation, and `--json` none either way. A cursor the server has already
  issued ends the drain with `E_VALIDATION` rather than fetching the same page
  forever.
- The project and server lines each verb prints are for a human watching a
  terminal: they make the boundary crossing visible, which the CLI guidelines
  ask for. They share stdout with the result, so they are printed only when
  stdout is a TTY — a piped or redirected run yields the table alone, and
  `--json` omits them either way.

## Reading one record

`get <id>` renders the record field by field on a terminal, headed by whatever
identifies it (a user's identifier, a team's name) and ordered by the
registry's `detail` list; fields the record does not carry are omitted rather
than printed blank. Piped — or with `--json` — it emits the object itself,
since a script wants the record, not a view of it. `--fields` overrides the
list on either path.

```console
$ zitadel users get user_01J…
ada@example.com

id                   user_01J…
identifier_property  email
status               active
schema               sch_01J…
created_at           2026-09-12T03:22:07Z
```

## Filtering and sorting

One grammar, every list:

- `--filter field=operation:value`, repeatable. The operation is optional and
  defaults to `equals`. Values are sent as strings; timestamps are RFC 3339.
- `--sort field:direction`, where the endpoint can sort; the direction defaults
  to `asc`.

What differs per resource is not the spelling but what each field accepts, and
that is declared in the registry so `--help` and `zitadel resources --json` can
state it per field:

```ts
filters: [
  { field: "status",     operations: USER_OPERATIONS },             // POST /query
  { field: "object_type", operations: ["equals"] },                 // GET parameter
  { field: "revisions",  operations: ["equals"], values: Object.values(ListSchemasRevisions) },
  { field: "category",   operations: ["equals"], combine: "or" },   // repeats widen
  {
    field: "created_at",                                            // one field,
    ...range({ greater_than_or_equal: "created_after", less_than: "created_before" }),
  },                                                                // two parameters
]
```

A query's operations come from its body's generated enum
(`USER_OPERATIONS` is `Object.values(QueryUsersBodyFilterItemOperation)`), and a
`GET` parameter's values from its own. A `GET` parameter filters by `equals`
only; a range is written with `range()`, which pairs each operation with the
parameter it travels as, and the registry's types refuse one written by hand.

Transport follows from the entry: a spec carrying `body` is assembled into a
filter body and validated against the generated Zod request schema
([ADR 031](../../adrs/031-openapi-querying.md)); one without it becomes query
parameters, each field naming the parameter its operation travels as. Either
way validation happens **before** the request, so an unknown field, an
unsupported operation, or a value outside a closed set fails with
`E_VALIDATION` naming what that field accepts — never as a server 400.

Repeated uses of a field combine with AND unless the field says `combine: "or"`,
which is what a repeated `GET` parameter does. The flag help and the discovery
output both say which, since it changes what the query means.

## Bodies

`create` and `update` take the body from three kinds of source, in any mix:
one flag per field, `--set` for a field by its path, and the whole document.
The decisions behind this are ADR 064 §6 and
[ADR 071](../../adrs/071-cli-resource-properties.md).

**One flag per field, nested ones included.** The generated request schema
names every field, its type, whether it is required, and its allowed values,
so the factory turns each leaf into a flag. `expires_at` becomes
`--expires-at`, and a nested field's flag is its path with each segment
kebab-cased, joined with `-`, so a connection's `oidc.client_id` is
`--oidc-client-id`. A closed value set becomes the flag's `options` (oclif
rejects anything else at parse time), a boolean takes `--no-<flag>` for
`false`, a list of scalars is a repeatable flag with one value per use, and the
schema's own description becomes the flag help. `--help` lists a top-level
field under `REQUIRED FIELD` or `OPTIONAL FIELD`, and a nested one under its
object (`OIDC FIELD`). Each required flag carries a `(required)` marker,
because oclif orders help groups by their first flag alphabetically rather
than by declaration. A field required only once its optional object is given
says so: `(required with oidc.*)`.

```sh
zitadel users create --schema human-user --attributes email=ada@example.com
zitadel grants create --relation viewer --user-identifier alice@acme.com
zitadel projects update prj_01J… --password-hash-algorithm bcrypt --password-hash-params-cost 12
```

A field whose flag would collide with another field's, or with a flag the
command owns, gets no flag, so neither shadows the other, and a unit test over
the registry fails when one does. A field no single flag can hold (an array of
objects) gets none either. Both stay reachable through `--set` and the
document.

A resource whose request wraps its document declares a **root**. An identity
provider connection travels as `{"idp": {…}}`, so its flags, `--set` paths,
`--data` and `--file` address the connection itself — the document `setup` and
`auth-method sso enable` write to `.zitadel/idps/<slug>.json` — and the factory
wraps it on the way out. A document still wrapped in `idp` is accepted too.

```sh
zitadel idps create --slug acme-sso --protocol oidc --display-name 'Acme SSO' \
  --oidc-issuer https://sso.acme.example --oidc-client-id abc123 \
  --oidc-client-secret '${{ ACME_SSO_CLIENT_SECRET }}' --oidc-scopes openid
zitadel idps create --file .zitadel/idps/acme-sso.json
```

An **open record** — a user's `attributes`, whose keys come from the project's
user schema rather than the API spec — becomes one repeatable flag with two
forms. `key:=value` parses the value as JSON, which is how a field the
customer's schema declares as a number, boolean, null, array, or object is
set. `key=value` is the value as the record's schema types it. The API spec
leaves `attributes` untyped, so there it is always text, and an identifier that
merely looks numeric (a postal code, a phone number) survives intact. The split
is HTTPie's, and keeping the two explicit means the CLI never guesses which was
meant:

```sh
zitadel users create --schema sch_01J… \
  --attributes email=ada@example.com \
  --attributes age:=42 \
  --attributes optIn:=true \
  --attributes 'tags:=["dev","ops"]' \
  --attributes postcode=02139
```

That stores `age` as a number, `optIn` as a boolean, `tags` as an array, and
`postcode` as the string `"02139"`. Sending `age=42` instead would be rejected
by the user schema, since the value would reach the server quoted. A malformed
JSON value fails locally and the error offers the string form.

**`--set` reaches any field by its path.** `--set <path>=<value>` and
`--set <path>:=<json>` assign one field of the document, in the dot-path
language `--fields` speaks, and repeat. The path is checked against the
request schema before any request: an unknown one is refused, naming the fields
near it, and any key is accepted below an open record
(`attributes.address.city`). `=` gives the value the type the schema declares
at the path, so `--set oidc.pkce_enabled=false` is the boolean, while a path the
schema types as a string keeps the text. A number is read in decimal notation
only, so `0x10` is refused rather than read as 16. A list or an object takes
`:=`, and a key with a dot in it is set through its parent:
`--set 'claim_mapping:={"a.b":"c"}'`.

```sh
zitadel idps create --file acme-sso.json --set oidc.pkce_enabled=false
zitadel users update user_01J… --set attributes.address.city=Zurich --set attributes.phone:=null
```

**The whole body at once.** `--data '<json>'` or `--file <path>`, where
`--file -` reads stdin. `--file -` with nothing piped in fails immediately
rather than waiting on the keyboard, which would look like a hang.

**The order they merge in.** The document comes first, then the field flags,
then each `--set` in the order given, each merged over the last. Objects merge
key by key, and any other value — a list, a scalar, `null` — replaces what was
there. So a template file and a flag mix: `--file user.json --attributes
givenName=Augusta` changes that one attribute and keeps the file's others. On
an update the result is a merge patch, in which `null` removes the key on the
server, as `PATCH /users/{id}` does with `attributes`.

**Credentials are refused on the command line.** Anything in argv is visible to
anyone running `ps`, is kept in shell history, and is captured by CI logs — and
`--data "$(cat body.json)"` is no exception, since the shell expands it before
the CLI runs. So free-form text under a property whose name reads as a secret
(`password`, `client_secret`, `userToken`, `api_key`, …) is refused from a field
flag, from a `--set` or `--attributes` entry, and anywhere inside an inline
`--data` body. The refusal points at the two routes that never touch argv:
`--file <path>` and `--file -`. Names that merely start the same way, such as
`passwordless`, are unaffected, and so is a URL under the name of an address
(`token_endpoint`) as long as it carries no credential of its own; any other
value there, `secret_url` holding the secret, is still refused. A value that
cannot be a credential passes too: a boolean,
a value the schema fixes (an enum value, or a number where it declares one), and
a `${{ NAME }}` reference to a project variable, the only form a connection's
`client_secret` accepts. Write a reference in single quotes, since inside
double quotes the shell reads `${` as its own expansion.

Required fields are not declared required to oclif — `--data` may carry them —
so presence is checked once every source is merged, and reported as the flags
the caller is missing rather than as schema issues. A nested field counts once
its optional object is given:

```console
$ zitadel grants create --expires-at 2030-01-01T00:00:00Z --json | jq -r '.message, .hint'
grants create is missing required field: --relation
Pass --relation, or include it in --data / --file. See `grants create --help`.
```

The assembled body is then validated against the generated request schema
locally, and what the schema accepts — with any default it fills in — is sent.
The server's resource is echoed back as `data`; a create additionally carries
`data.next_commands` pointing at the matching `get`. `--dry-run` emits
`{ dry_run: true, verb, topic, id?, body }` and makes no request. Its `body` is
what would be sent, with only credentials masked, so it can be checked and
saved as a document to send later with `--file`.

## Deleting

- `delete` means the resource is gone. An endpoint that changes state and
  leaves the resource readable is named after what it does: `sessions revoke`,
  `teams deactivate`. This is `gh`'s rule — secrets are deleted, pull requests
  are closed — and it keeps the verb from lying about the outcome.
- Interactive runs confirm first. Non-interactive runs require `--force`, the
  same guard as `reset`; without it the command fails with `E_VALIDATION` and a
  `next_commands` entry carrying the exact retry. `--force` is declared per
  command rather than globally: what it permits differs (here a deletion, on
  `setup` overwriting a managed file), so each command describes its own —
  `Delete the team without the confirmation prompt` rather than a generic line
  about files.
- `--dry-run` reports the target and makes no request, and it answers before the
  `--force` guard: a preview that sends nothing needs no permission, which is
  also the order `reset` uses.
- Success reports what the API actually did, which is not always removal:
  `{ "id": "…", "deleted": true }` for users and grants, `"revoked"` for
  sessions, and `"deactivated"` for teams, whose DELETE deactivates the team and
  leaves it readable (ADR 024). The API answers `204` with no body, so the CLI
  echoes the id rather than inventing a resource; read the property beside `id`
  rather than assuming `deleted`.
- A declined confirm returns `status: "skipped"` with reason `<verb>-cancelled`.

## Errors

HTTP failures map through the CLI's existing taxonomy: `401`/`403` →
`E_AUTH`, `404` → `E_NOT_FOUND`, other `4xx` → `E_VALIDATION`, `5xx` →
`E_NETWORK`. Local validation failures are `E_VALIDATION` with `details.issues`.

## Open decisions

1. **Bulk delete.** One id per invocation today. A multi-id form should report
   per id rather than stop at the first failure.
2. **Filter value typing.** Every value is a string. Numeric or boolean filter
   fields would need a per-field cast in the registry.
