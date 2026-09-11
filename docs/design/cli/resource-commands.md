# CLI Resource Commands

> **Status:** Shipped — `users`, `teams`, `sessions`, `events`, `grants`, `projects`.
> **Context:** The imperative surface for runtime resources that
> [README.md](README.md#what-lives-in-zitadel-and-what-doesnt) reserves for
> data the developer does not own in git. Config resources (schemas, flows,
> branding, releases) stay on `plan` / `apply` ([ADR 007](../../adrs/007-gitops-configuration-surface.md),
> [ADR 035](../../adrs/035-configuration-environments.md)).

## Shape

Each runtime resource exposes the verbs its API supports — the table below says
which — and every verb that exists behaves the same way, with the same flags and
the same envelope. That uniformity is in how a verb works, not in which verbs a
resource has:

```
zitadel <resource> list    [--filter …] [--sort …] [--limit N] [--page-token T | --all]
zitadel <resource> get     <id>
zitadel <resource> create  --data '<json>' | --file <path|->
zitadel <resource> update  <id> --data '<json>' | --file <path|->
zitadel <resource> delete  <id> [--force]        # `revoke` for sessions
```

The verbs are generated from one registry
([`apps/cli/src/commands/resources.ts`](../../../apps/cli/src/commands/resources.ts))
by a platform-agnostic factory
([`apps/cli/src/lib/oclif/crud/`](../../../apps/cli/src/lib/oclif/crud/)).
The registry names the client call per verb, the id field, the table columns,
and the filterable and sortable fields. The factory owns everything below.
Adding a backend resource is adding a registry entry.

| Resource   | Verbs                             | Backing endpoints                                   |
| ---------- | --------------------------------- | --------------------------------------------------- |
| `users`    | list, get, create, update, delete | `POST /users/query`, `/users/{id}`                  |
| `teams`    | list, get, create, update, delete | `POST /teams/query`, `/teams/{id}`                  |
| `sessions` | list, get, revoke                 | `POST /sessions/query`, `DELETE /sessions/{id}`     |
| `events`   | list, get                         | `GET /events`, `GET /events/{id}`                   |
| `grants`   | list, get, create, delete         | `POST /grants/query`, `/grants/{id}`                |
| `projects` | list, get, update                 | `POST /projects/query`, `/projects/{id}`            |

## Anatomy

Every verb is a class with the same two members, so the operations read alike:

| File                                      | Owns                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `crud/ops/command.ts`                     | `ResourceCommand` — parse, resolve meta, `execute`, emit; `bindOperation`, which holds each command's definition in a `WeakMap` beside the class rather than as a static, since oclif copies a command's own statics into `commands --json` and the published manifest |
| `crud/ops/list.ts`, `read.ts`, `write.ts`, `delete.ts` | One `*Operation` class each: static `describe()` → oclif statics, `execute()` → `CommandResult` |
| `crud/paging.ts`, `table.ts`, `body.ts`, `query.ts`, `fields.ts` | Pure helpers: cursor draining, table rendering, body loading, filter grammar, schema-to-flag generation |
| `crud/types.ts`                           | The registry contract, generic over the platform connection `Ctx`  |

`buildResourceCommands` binds each registry entry to its operation classes and
returns oclif command classes keyed by id (`users:list`).

## Discovery

`zitadel resources` answers, in one call, what an agent otherwise pieces
together from eight `--help` invocations: which resources exist, the verbs each
exposes, what its list can filter and sort on, and the body fields of its
writes. It is a projection of the registry, talks to no server, and is the role
`stripe resources` and `kubectl api-resources` play in those CLIs.

```console
$ zitadel resources
resource  verbs                              filter on
--------  ---------------------------------  ---------------------------------------------
users     list, get, create, update, delete  created_at, id, schema, status, team_id, …
teams     list, get, create, update, delete  created_at, name, status
sessions  list, get, revoke                  created_at, user_id, state, …
```

`--json` also carries `delete_outcome`, the property a delete's envelope puts
beside `id` — `deleted`, `revoked`, or `deactivated` — so an agent need not
guess which. And it adds the write fields per verb — `create_fields` and `update_fields`,
each with flag name, kind, whether it is required, and any closed value set — so
a create can be assembled without guessing, and an update is not described with
the create's required fields.

## Credential and scope

Every verb reads `.zitadel/secret` and sends the project secret as the bearer
(operator plane, [ADR 036](../../adrs/036-api-credential-planes.md)). Endpoints
that take `project_id` receive it from the secret; there is no project flag.
The server is resolved exactly as for `apply` (`--server`, `ZITADEL_API_BASE`,
`zitadel.json`, default).

## Listing and pagination

- `list` returns **one page**. The server's default page size applies unless
  `--limit N` (1–100) is given.
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
  { "status": "ok", "data": { "items": [ … ], "count": 42, "next_page_token": "…" } }
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

Query-backed lists (`POST /<resource>/query`, [ADR 031](../../adrs/031-openapi-querying.md)):

- `--filter field=operation:value`, repeatable, AND-combined. The operation is
  optional and defaults to `equals`. Values are sent as strings; timestamps are
  RFC 3339.
- `--sort field:direction`; the direction defaults to `asc`.
- The assembled body is validated against the generated Zod request schema
  **before** any request, so an unknown field or operation fails with
  `E_VALIDATION` and the accepted values in `hint`. A unit test pins the fields
  advertised in `--help` to the schema's enums.

Parameter-backed lists (`GET /events`) expose one named flag per query
parameter instead (`--category`, `--actor-id`, `--created-after`, …).
Repeatable flags become array parameters.

## Bodies

`create` and `update` accept the body two ways, and they can be combined.

**One flag per field.** The generated request schema names every field, its
type, whether it is required, and its allowed values, so the factory turns each
into a flag: `principal_type` becomes `--principal-type`, a closed value set
becomes the flag's `options` (oclif rejects anything else at parse time), and
the schema's own description becomes the flag help. `--help` groups them under
`REQUIRED FIELD` and `OPTIONAL FIELD`, and each required flag also carries a
`(required)` marker, because oclif orders help groups by their first flag
alphabetically rather than by declaration.

```sh
zitadel grants create --principal-type user --principal-id user_01J… --relation viewer
```

An **open record** — a user's `attributes`, whose keys come from the project's
user schema rather than the API spec — becomes one repeatable flag with two
forms. `key=value` is always a string, so an identifier that merely looks
numeric (a postal code, a phone number) survives intact. `key:=value` parses the
value as JSON, which is how a field the customer's schema declares as a number,
boolean, null, array, or object is set. The split is HTTPie's, and keeping the
two explicit means the CLI never guesses which was meant:

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

Fields the CLI cannot express as a single flag (nested objects, arrays) are
absent from the flag list and stay reachable through the raw body.

**Credentials are refused on the command line.** Anything in argv is visible to
anyone running `ps`, is kept in shell history, and is captured by CI logs — and
`--data "$(cat body.json)"` is no exception, since the shell expands it before
the CLI runs. So a property whose name reads as a secret (`password`,
`client_secret`, `userToken`, `api_key`, …) is refused both as an `--attributes`
entry and anywhere inside an inline `--data` body, pointing at the two routes
that never touch argv: `--file <path>` and `--file -`. Names that merely start
the same way, such as `passwordless`, are unaffected.

**The whole body at once.** `--data '<json>'` or `--file <path>`, where
`--file -` reads stdin. `--file -` with nothing piped in fails immediately
rather than waiting on the keyboard, which would look like a hang. A field flag overrides the same key in the raw body, so
the two mix: load a template from a file and override one value on the command
line.

Required fields are not declared required to oclif — `--data` may carry them —
so presence is checked once both sources are merged, and reported as the flags
the caller is missing rather than as schema issues:

```console
$ zitadel grants create --principal-id user_01J… --json | jq -r '.message, .hint'
grants create is missing required fields: --principal-type, --relation
Pass --principal-type and --relation, or include them in --data / --file. See `grants create --help`.
```

Either way the assembled body is validated against the generated request schema
locally, then sent as-is. The server's resource is echoed back as `data`;
a create additionally carries `data.next_commands` pointing at the matching
`get`. `--dry-run` emits `{ dry_run: true, verb, topic, id?, body }` and makes no
request.

## Deleting

- The verb is `delete` unless the API's own vocabulary differs (`sessions revoke`).
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
3. **Config-resource reads.** `flows`, `schemas`, `branding`, `releases`, and
   `environments` could gain `list` / `get` through the same factory; their
   write path stays `apply` / `deploy`.
