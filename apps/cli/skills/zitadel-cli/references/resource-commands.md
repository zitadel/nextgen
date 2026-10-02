## Resource commands

Runtime resources — users, teams, sessions, events, grants, projects — have a
uniform `zitadel <resource> <verb>` surface built from one registry
(`src/commands/resources.ts`); the conventions are documented in
`docs/design/cli/resource-commands.md`. Config resources (schemas, flows,
branding) stay on `plan` / `apply`; the resource commands never write them.

| Resource   | Verbs                                  |
| ---------- | -------------------------------------- |
| `users`    | list, get, create, update, delete      |
| `teams`    | list, get, create, update, deactivate  |
| `sessions` | list, get, revoke                      |
| `events`   | list, get                              |
| `grants`   | list, get, create, delete              |
| `projects` | list, get, update                      |

Every verb reads the project credential from `.zitadel/secret` and injects
`project_id` itself; there is no project flag.

`zitadel resources --json` reports the whole surface in one call: every
resource, its verbs, its `filter_fields` / `sort_fields`, and the fields of its writes,
reported per verb as `create_fields` and `update_fields` (flag name, kind,
`required`, and any closed value set), and `delete_outcome`, the property a
delete's envelope carries beside `id`. Prefer it
over reading `--help` per command. It contacts no server.

- `list` emits `data: { items, count, next_page_token }`, and when a page
  remains, `data.next_commands` carries the exact command for the next page —
  the cursor repeated alongside the same `--limit`, `--sort` and `--filter`,
  since a token is only valid with the query that issued it. Prefer it over
  rebuilding the invocation yourself. One page by default
  (`--limit`, `--page-token`); `--all` drains every page and sets
  `next_page_token` to `null`. Query-backed lists take `--filter
  field=operation:value` (repeatable, AND-combined; the operation defaults to
  `equals`) and `--sort field:asc|desc`; the accepted fields are listed in
  `--help` and an unknown one fails with `E_VALIDATION` before any request.
  `events list` takes its filters as named flags (`--category`, `--actor-id`,
  `--created-after`, …).
- `--fields id,attributes.email` chooses which columns the human rendering
  shows (dot-paths allowed); an unknown path fails before any request, with the
  available ones in `details.available`; a user's schema-defined `attributes`
  accept any key. `--json` always carries the whole resource regardless.
- `get <id>` emits the resource as `data`. Its human rendering lays the record
  out field by field on a terminal and prints the whole object when piped;
  `--json` is unchanged either way.
- `create` / `update <id>` take the body either as one flag per schema field
  (`--name`, `--relation`, …; run `<resource> create --help` for the
  list, where required fields are marked `(required)`) or as a whole JSON
  object via `--data '<json>'` / `--file <path>` (`--file -` reads stdin). A
  field flag overrides the same key in `--data`. A user's schema-defined
  `attributes` are set with the repeatable `--attributes`, where `key=value` is
  always a string and `key:=value` parses the value as JSON — use `:=` for a
  field the user schema types as a number, boolean, null, array, or object
  (`--attributes age:=42`), and `=` to keep a numeric-looking identifier a
  string (`--attributes postcode=02139`). A missing
  required field fails with `E_VALIDATION`, naming the flags in `message` and
  listing their wire names in `details.missing`. The body is validated against
  the API schema locally, and the server's resource is emitted as `data`. A create adds
  `data.next_commands` pointing at the matching `get`. `--dry-run` emits
  `{ dry_run: true, verb, topic, body }` without calling the platform.
- The destructive verb (`delete`, `revoke`, `deactivate`) requires `--force` in non-interactive mode (declared per command, so its help says what it permits)
  (the error's `next_commands` carries the exact retry) and reports what the API
  did: `{ id, deleted: true }` for users and grants, `{ id, revoked: true }` for
  sessions, and `{ id, deactivated: true }` for teams, whose DELETE deactivates
  the team and leaves it readable (ADR 024). Read the property that accompanies
  `id` rather than assuming `deleted`.

```sh
npx @zitadel/cli@alpha users list --filter status=active --sort created_at:desc --non-interactive --json
npx @zitadel/cli@alpha users create --schema sch_… --attributes email=a@b.c --non-interactive --json
npx @zitadel/cli@alpha sessions revoke sess_… --force --non-interactive --json
```

