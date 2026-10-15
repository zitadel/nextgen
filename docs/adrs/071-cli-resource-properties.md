# ADR 071: Passing Properties to CLI Resource Commands

> **Status:** Proposed
> **Date:** 2026-10-15
> **Context:** `idps create` takes an identity provider connection only as a
> whole JSON document. The same question applies to every resource whose body
> nests: users, grants and projects too.
> **Amends:** [ADR 064](064-cli-resource-commands.md) §6 (body fields as flags)
> and §13 (credentials on the command line)
> **Relates to:** [ADR 004](004-agent-contract-and-agents-md.md),
> [ADR 020](020-credentials-out-of-user-schema.md),
> [ADR 062](062-per-environment-variables-and-secrets.md),
> [ADR 070](070-cli-auth-method-toggles.md)

The examples use the singular nouns of ADR 064's 2026-10-07 amendment
(`zitadel idp create`). The shipped commands are still plural
(`zitadel idps create`), and the behaviour quoted under *Context* was observed
on them.

## TL;DR

- Every way of giving a write a property is an assignment into **one JSON
  document**: a generated flag, `--set`, a template, `--file`, `--data`, stdin
  or a prompt. The sources merge in a fixed order. The result is validated
  against the schema that defines it, and that document is what is sent and
  what `--dry-run` prints.
- **Every leaf gets a flag**, nested ones too: `oidc.client_id` is
  `--oidc-client-id`. Whatever no single flag can hold is reached with
  **`--set path=value`**, in the dot-path language `--fields` already speaks.
- **A resource can start from a template.** `zitadel idp create --provider
  google` composes the connection `setup` writes, and asks for the client
  secret on a prompt or stdin, never as a flag.
- **`attributes` are checked against the user schema** that defines them, so a
  typo, a missing property or `age=42` is settled before the request.
- **A `${{ NAME }}` reference is not a credential.** It may appear on a command
  line, and a preview shows it.

## In practice

A person at a terminal:

```sh
zitadel idp create --provider google    # asks for the client id and secret
zitadel user create                     # asks for each required attribute
```

A script:

```sh
zitadel idp create --provider google --oidc-client-id "$CLIENT_ID" -n --json < secret.txt
zitadel user create --attributes email=ada@example.com --attributes age=42 -n --json
```

An agent:

```sh
zitadel resources --json        # every field of every write, nested ones included
zitadel idp create --provider custom --slug acme-sso --display-name 'Acme SSO' \
  --oidc-issuer https://sso.acme.example --dry-run -n --json   # the document it would send
zitadel idp create --file - -n --json < acme-sso.json          # or a document written directly
```

## Context

ADR 064 §6 gives a write three ways to receive its body. Each top-level scalar,
enum or open-record field of the generated request schema becomes a flag. A
whole JSON document comes with `--data` or `--file`. The two combine, and a
flag overrides the same top-level key of the document. That covers flat
bodies: `team create --name`, `grant create --relation` and
`user create --attributes email=…` read well.

It stops at the first nested object, and the identity provider connection is
nested throughout. Everything in `CreateIdpBody` sits under `idp`, and the
protocol settings under `idp.oidc`. On the shipped CLI:

| What                                                          | Result                                                                                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zitadel resources --json`                                    | `idps` reports `create_fields: []`. An agent learns nothing about the body.                                                                                                        |
| `zitadel idps create --help`                                  | Only `--data` and `--file`. Its example, `--file ./identity provider connection.json`, does not run.                                                                               |
| `idps create --data '{"idp":{…"client_secret":"${{ ACME_CLIENT_SECRET }}"…}}'` | Refused: `Refusing to read "client_secret" from --data`. The API accepts nothing but a `${{ NAME }}` reference there, so `--data` cannot create a connection at all. |
| The same document with `--file -`                             | Accepted. It is the only form that works, with a shape the CLI never shows.                                                                                                        |
| `--dry-run` on it                                             | `id_token_mapping`, `token_endpoint_auth_method` and the reference print as `«redacted»`, because their names contain `token` or `secret`. The preview can be neither checked nor reused. |
| `scopes` left out                                             | The CLI sends `["openid","profile","email"]`, the Zod schema's default. The API says it never injects that default, and refuses a connection without `scopes`.                      |

The same gaps reach the other resources:

- **`grant create`** names its principal in a nested `user` or `team` object,
  so the principal has no flag.
- **`user create --file user.json --attributes givenName=Augusta`** sends
  `{"attributes":{"givenName":"Augusta"}}`. The flag replaces the file's whole
  `attributes` object instead of one key in it, the opposite of what the
  [design doc](../design/cli/resource-commands.md#bodies) promises ("load a
  template from a file and override one value").
- **`user create --attributes age=42`** sends the string `"42"`, which a user
  schema that declares `age` an integer refuses. A misspelled attribute also
  fails only at the server.
- **`project update --password-hash`** is a string flag, but `password_hash` is
  an object (`{"algorithm": …, "params": {…}}`) or `null`. The flag can never
  produce a valid body. `--data '{"password_hash": {…}}'` is refused as a
  credential, because the name contains `password`, and the preview of
  `--file -` prints the whole policy as `«redacted»`. A hashing method is not a
  credential.

Two audiences use these commands, and they need different things:

- **A person at a terminal** wants a short command for the common case,
  `--help` that lists the fields, tab completion, and to be asked for what is
  missing.
- **An agent or a script** wants a single call that describes every field,
  nested ones included. It wants a deterministic grammar, and the option to send
  a whole JSON document, which agents write well but whose shape they guess
  badly. It wants a preview it can check, and errors that name every missing
  field at once.

## Decision

### 1. One document, assembled in a fixed order

A write builds one JSON document, validates it, and sends it. Every input is an
assignment into that document, applied from lowest to highest precedence:

1. the **template** chosen with the resource's template flag (§4), if any;
2. the **document** from `--file <path>`, `--file -` or `--data`, which stay
   exclusive with each other;
3. the **field flags** (§2);
4. the **`--set` assignments** (§3), in the order given;
5. the **answers to prompts** for required fields that are still missing (§6).

Documents merge as a JSON Merge Patch
([RFC 7396](https://www.rfc-editor.org/rfc/rfc7396)). Objects merge key by key,
arrays and scalars replace, and `null` removes a key. `PATCH /users/{id}`
already applies that rule to `attributes`, so a body built locally and a patch
applied by the server follow the same rule. A flag over a file changes one key,
not the object around it.

The merged document is validated against the request schema before any
request, as today. **What is sent is the document as assembled**, not the
schema's parse result, so validation never adds a value nobody gave. A default
belongs to the server, or to a template that sets it on purpose (§4).

A registry entry may declare a **document root**. For identity providers it is
`idp`: flags, `--set` paths, `--file` and `--data` all address the connection
itself, and the factory wraps it as `{"idp": …}` on the way out. The CLI then
takes the document that `setup` and `auth-method sso enable` write to
`.zitadel/idps/<slug>.json`, so `zitadel idp create --file
.zitadel/idps/google.json` works as it is. A document still wrapped in `idp` is
accepted too. The connection schema has no `idp` property, so the wrapper
cannot be mistaken for a field.

### 2. Every leaf of the document gets a flag

ADR 064 §6 stops at top-level fields. The generator now recurses into nested
objects. A leaf's flag is its path with each segment kebab-cased, joined with
`-`, so `oidc.client_id` is `--oidc-client-id`. It is the same mechanical rule
extended, and a flag can still be derived from the API reference and back.

| Schema type at the leaf                                  | Flag                                                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| string, number, integer                                  | a typed flag, as today                                                                   |
| enum                                                     | a flag with `options`, which oclif checks at parse time, as today                        |
| boolean                                                  | `--[no-]<flag>`, so a `true` default can be turned off (`--no-oidc-pkce-enabled`)        |
| array of scalars                                         | repeatable, one element per use; the list replaces the template's or the document's      |
| open record (`claim_mapping`, `attributes`)              | repeatable `key=value`, as today; the keys are taken literally                           |
| object that may be `null` (`password_hash`)              | flattened like the object; `null` is `--set password_hash:=null`                         |
| anything else (an array of objects, a union of objects)  | no flag; reached with `--set` (§3) or the document                                       |

For the identity provider connection the rule yields twenty flags, one per
leaf, without a collision:

| Path                                                                                  | Flag                                                       | Kind                            |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------- |
| `slug`                                                                                | `--slug`                                                   | string, required                |
| `protocol`                                                                            | `--protocol`                                               | enum `oidc`, required           |
| `display_name`                                                                        | `--display-name`                                           | string, required                |
| `template`                                                                            | `--template`                                               | string                          |
| `subject_claim`                                                                       | `--subject-claim`                                          | string                          |
| `claim_mapping`, `verified_claims`                                                    | `--claim-mapping`, `--verified-claims`                     | record                          |
| `provisioning.creation`                                                               | `--provisioning-creation`                                  | enum `disabled`, `auto`         |
| `oidc.issuer`                                                                         | `--oidc-issuer`                                            | string                          |
| `oidc.client_id`                                                                      | `--oidc-client-id`                                         | string                          |
| `oidc.client_secret`                                                                  | `--oidc-client-secret`                                     | string, a `${{ NAME }}` reference |
| `oidc.scopes`                                                                         | `--oidc-scopes`                                            | list                            |
| `oidc.token_endpoint_auth_method`                                                     | `--oidc-token-endpoint-auth-method`                        | enum                            |
| `oidc.pkce_enabled`, `oidc.id_token_mapping`                                          | `--[no-]oidc-pkce-enabled`, `--[no-]oidc-id-token-mapping` | boolean                         |
| `oidc.authorization_endpoint`, `oidc.token_endpoint`, `oidc.userinfo_endpoint`, `oidc.jwks_uri` | `--oidc-authorization-endpoint`, …               | string                          |
| `oidc.static_authorize_parameters`                                                    | `--oidc-static-authorize-parameters`                       | record                          |

The same rule gives `grant create` its principal (`--user-identifier
alice@acme.com`, `--user-user-id`, `--team-name`, `--team-team-id`), and
`project update` its hashing method:

```sh
zitadel project update <id> --password-hash-algorithm argon2id \
  --password-hash-params-time 3 --password-hash-params-memory 65536 --password-hash-params-threads 4
```

Some names stutter (`--user-user-id`). The rule stays mechanical anyway,
because a hand-picked alias is a name nobody can derive.

`--help` groups the flags by their top-level object (`OIDC FIELD FLAGS`) and
keeps the `(required)` marker in each description, as today. Paths that would
flatten onto the same flag, or onto a flag the command owns (`--set`, `--file`,
`--data`, the template flag, the global flags), get no flag, so neither shadows
the other, and stay reachable through `--set`. A unit test runs the generator
over the whole registry and fails on any such collision, so a schema change
that causes one is noticed rather than shipped.

### 3. `--set` reaches any path

`--set` is repeatable and has two forms, the split ADR 064 §6 already uses for
record entries:

```text
--set <path>=<value>     a string, or the type the schema declares at <path>
--set <path>:=<json>     JSON: a number, boolean, null, array or object
```

`<path>` is the dot-path language of `--fields` (ADR 064 §9), checked the same
way, against the request schema, before any request. An unknown path is
refused, and the error lists the paths that exist. Below an open record any key
is accepted (`attributes.<anything>`), while a misspelled declared segment
(`oidc.isuer`) is caught. A key that itself contains a dot is set through its
parent, as JSON: `--set 'claim_mapping:={"a.b":"c"}'`. There is no index or
append syntax, so an array is set whole with `:=`. Brackets need quoting in
zsh, and an index into a list the caller has not seen is a guess.

**`=` takes the type the schema declares.** ADR 064 §6 made `key=value` always a
string, because the CLI could not know a field's type, and guessing turns a
postal code into a number. Where a schema declares the type at the path, the
CLI is no longer guessing:

- `--set oidc.pkce_enabled=false` sends the boolean `false`.
- `age=42` sends a number when the user schema declares `age` an integer (§5).
- Where the schema allows a string, or says nothing, `=` stays a string, so
  `postcode=02139` survives.
- A value that does not parse as the declared type is refused, and the error
  offers the `:=` form.

The rule covers record entries too, whose value type the schema also declares.
`verified_claims` values are `boolean | string`, so `--verified-claims
email=true` stays the string `"true"`, a claim name, while `email:=true` is the
boolean. `:=` keeps its meaning everywhere.

Field flags and `--set` write into the same document. A flag is the documented,
completed and parse-checked spelling of one path. `--set` is the general one,
spelled with the wire names, so a key read from `get --json` can be typed back
as it is. Every flag is equivalent to a `--set`, which is how one merge engine
serves both.

### 4. A resource can start from a template

A registry entry may name **templates**: complete starting documents for common
cases, chosen with a flag the entry names, with the other inputs layered over
them (§1). A template is only a starting document. The flags that change it are
the generated ones from §2, not a second set of flags for each template.

Identity providers take theirs from the catalog in
[`@zitadel/config/idp`](../../packages/config/src/idp/index.ts), the
`OidcProvider.connection()` that `setup` and `auth-method sso enable` already
use, under the flag **`--provider`**:

- `--provider google` starts from the connection `setup` writes for Google:
  its issuer, scopes, claim mapping and verified claims, and
  `prompt=select_account`.
- `--provider custom` starts from the standard OpenID Connect claim set and the
  default scopes. It leaves `slug`, `display_name` and `oidc.issuer` to the
  caller, and when they are left out they are asked for or reported as missing
  (§6).

The flag is `--provider` rather than `--template` for two reasons. `template`
is a field of the connection document, which §2 already gives `--template`.
And `--provider` is the word ADR 070 chose for `auth-method sso enable`.

The template references its credentials as `${{ <SLUG>_CLIENT_ID }}` and
`${{ <SLUG>_CLIENT_SECRET }}`, as `setup` does. When the project does not hold
a referenced variable yet, the command does what `auth-method sso enable` does.
It asks for the value through `input`, the secret only on a prompt or from
stdin and never from a flag, and publishes it as a project variable
(`storeClientSecret` and `publishClientId` in
[`apps/cli/src/lib/idp/credentials.ts`](../../apps/cli/src/lib/idp/credentials.ts)).
When nobody can be asked and nothing is piped, `input` refuses as it does for
`auth-method sso enable`, naming stdin. `--oidc-client-id <literal>` replaces
the client id reference, which the connection schema allows when one client
serves every environment.

```sh
# Any other OpenID Connect provider, with one more scope than the default
zitadel idp create --provider custom --slug acme-sso --display-name 'Acme SSO' \
  --oidc-issuer https://sso.acme.example \
  --oidc-scopes openid --oidc-scopes profile --oidc-scopes email --oidc-scopes groups

# Google without the account chooser it adds by default
zitadel idp create --provider google --set oidc.static_authorize_parameters:=null

# No template: a document from a file, or nothing but flags
zitadel idp create --file .zitadel/idps/acme-sso.json
zitadel idp create --slug acme-sso --protocol oidc --display-name 'Acme SSO' \
  --oidc-issuer https://sso.acme.example --oidc-client-id abc123 \
  --oidc-client-secret '${{ ACME_SSO_CLIENT_SECRET }}' --oidc-scopes openid
```

Users get no templates. Their user schema plays that role (§5).

### 5. An open record is checked against the schema that defines it

`attributes` is open in the API's request schema and closed in the project's
user schema. `user create` and `user update` read that schema and validate
against it, instead of leaving every mistake to the server:

- **`--schema` is optional when the project has one user schema.** It is the
  rule the `auth-method` commands already apply (`selectSchema` in
  [`apps/cli/src/lib/idp/schemas.ts`](../../apps/cli/src/lib/idp/schemas.ts)).
  With several schemas it is required.
- **The schema read is the one the server will validate against**: the current
  revision of the named schema, fetched the way `schema get` fetches it. When
  the read fails, the command says so in `warnings` and leaves validation to the
  server. A read changes nothing, so `--dry-run` makes it too.
- **With the schema in hand**, an unknown attribute is refused with the
  properties that exist, a `=` value takes the declared type (§3), and missing
  required properties are asked for or listed (§6).

Nested attributes are reached through paths, as in
`--set attributes.address.city=Zurich`. `--attributes` keeps taking its keys
literally and does not change.

### 6. Missing input is asked for on a terminal and listed everywhere else

After merging, the command collects every required leaf that is still missing,
not only the first.

- **When it may prompt**, on a terminal and without `--non-interactive`, it asks
  for each one through `input`
  ([`apps/cli/src/lib/input.ts`](../../apps/cli/src/lib/input.ts)) in schema
  order. An enum is a select, a boolean a confirm, and a string is text that
  its pattern checks as it is typed. This is the "command-driven with optional
  interaction" model of the draft
  [overarching CLI design](https://github.com/zitadel/nextgen/pull/1226).
  `zitadel idp create --provider custom` becomes a short guided create without
  becoming a wizard. A credential is never asked for here: only a template asks
  for one (§4).
- **Otherwise** the command fails with one `E_VALIDATION` that lists them all in
  `details.missing` (`[{ "path": "oidc.issuer", "flag": "--oidc-issuer" }, …]`),
  with a hint that names the flags and `--set`. It suggests no command, because
  a value the caller has not given cannot be filled in, and ADR 064 §8 allows
  only suggestions that run as typed.

### 7. A reference is not a credential

ADR 064 §13 keeps credentials off the command line by matching field names
against a wordlist, and admits that the list is wrong in both directions. Two
exceptions remove the wrong cases this ADR runs into. The wordlist itself stays
until the schema-derived signal §13 asks for exists.

- **A whole-value `${{ NAME }}` reference
  ([ADR 062](062-per-environment-variables-and-secrets.md)) is not a
  credential.** It is accepted in `--data`, in `--set` and in a record entry,
  and a preview shows it. It is the only form the API accepts for
  `oidc.client_secret`, and it names a variable without revealing its value.
  Refusing it sends the caller to a file for no gain.
- **Only a free-form string can be a credential.** The guard and the redaction
  look at a value's leaves. A string leaf whose own key or an ancestor's names a
  credential is refused and redacted, as such a key is today. A boolean, a
  number, a value from the field's enum, or a reference is neither. That clears
  `oidc.id_token_mapping`, `oidc.token_endpoint_auth_method` and the whole of
  `password_hash`, whose leaves are enum values and numbers.

A secret's value still never travels as an argument. It comes from a prompt or
stdin, and is published as a variable (§4, `variables set`). Help and examples
write references in single quotes: inside double quotes, bash stops at `${{`
with "bad substitution" before the CLI runs.

### 8. `--dry-run --json` is the template generator

The document is assembled locally (§1), and the preview hides only credentials
(§7). `--dry-run --json` therefore prints exactly what would be sent. That
makes it a skeleton generator, as the AWS CLI's `--generate-cli-skeleton`,
1Password's `op item template get` and `kubectl create --dry-run=client -o
yaml` are in those tools:

```sh
zitadel idp create --provider google --dry-run --json | jq '.data.body' > google.json
# edit google.json, then
zitadel idp create --file google.json
```

A dry run publishes nothing. A variable the document references and the
project does not hold is reported in `warnings` rather than asked for.

### 9. Discovery describes every leaf

`zitadel resources --json` reports, for each entry of `create_fields` and
`update_fields`:

- `path`;
- `flag`, or `null` when only `--set` reaches the path;
- `kind`: `string`, `number`, `integer`, `boolean`, `enum`, `list`, `record` or
  `json`;
- `required`, `options`, `default`, and a one-line `description`.

Each resource also reports its `document_root`, and its templates with the flag
that chooses them (`{ "flag": "--provider", "names": ["google", "custom"] }`).
From that one call an agent can assemble flags, `--set` assignments or a whole
document, which is what ADR 064 §7 asks the surface to allow. `--help` gains a
short BODY section that states the order of §1.

### 10. Updates use the same grammar

`update <id>` assembles its patch from the same sources and sends only what was
given. `--set <path>:=null` removes a key, as RFC 7396 says and as
`PATCH /users/{id}` does with `attributes`.

Identity providers have no update endpoint. `POST /idps` with an existing slug
writes a new revision, and a revision holds the whole connection. Once §1
holds, changing one field composes from two commands:

```sh
zitadel idp get <id> --json | jq '.data.definition | .display_name = "Google Workspace"' \
  | zitadel idp create --file -
```

Whether an `idp update <id>` should make that read-modify-write itself is left
open below.

## Alternatives considered

- **Whole documents only, as today.** Rejected: the shape cannot be discovered,
  the guard blocks the inline form, and a person has to type JSON into a shell.
- **A hand-written command per resource**, like `auth-method sso enable`.
  Rejected for resource writes. ADR 064 §4 generates every resource command
  from one registry, because hand-written flags drift from the API. Workflow
  commands such as `auth-method` stay, because they edit several files at once
  rather than write one resource.
- **`--set` without nested field flags.** Rejected: `--help` would stop being
  the field reference ADR 064 §6 makes it, and enums would be neither checked at
  parse time nor completed.
- **Nested field flags without `--set`.** Rejected: a key below an open record,
  or a future array of objects such as a SAML certificate list, could then only
  be reached by switching to a whole document.
- **Brackets for nesting** (`oidc[issuer]=…`, as in HTTPie 3). Rejected: zsh
  takes an unquoted `[…]` for a pattern and refuses the word, and the CLI
  already uses dot-paths for `--fields`.
- **JSON Patch operations** (`--add /oidc/scopes/-=groups`, as in Ory's CLI).
  Rejected: exact, but a second path syntax (JSON Pointer), verbose for the
  common case, and merge patch already matches `PATCH /users/{id}`.
- **A shorthand syntax** (`Key=a,Value=b` in the AWS CLI, `{a:b}` in the Azure
  CLI). Rejected: a small language with its own quoting rules. `:=` takes JSON,
  which agents write natively.
- **Inferring a type without a schema** (`42` becomes a number). Rejected
  already by ADR 064 §6, because of postal codes. §3 types a value only where a
  schema declares the type.
- **A flag per user-schema property** (`user create --given-name Ada`).
  Rejected: oclif declares flags before it parses, so `--help` and
  `commands --json` would differ between projects.
- **A separate skeleton flag** (`--generate-cli-skeleton`). Rejected:
  `--dry-run --json` prints the same document (§8).
- **`key=@file` for a string read from a file**, as in HTTPie. Rejected for
  now: `--attributes handle=@ada` would read a file named `ada`, and a value
  that starts with `@` is ordinary user data. `--file` covers whole documents.
- **YAML documents.** Deferred: every document under `.zitadel/` is JSON, and a
  second format doubles the parsing and the error surface.
- **A `--client-secret` flag.** Rejected, as in ADR 064 §13 and
  [IdP area 4](../design/idp/4-cli-provider-setup.md): a secret never travels
  in argv.

## Consequences

- **The existing forms keep their meaning.** `--data`, `--file`,
  `--attributes key=value` and `key:=json`, and the top-level flags all stay.
  Three behaviours change. A flag over a file changes one key instead of
  replacing its parent object. `=` on a path the schema types as a number or
  boolean sends that type, where today it sends a string the server refuses.
  And the CLI stops sending Zod defaults nobody asked for, which breaks one call
  that works today: an `idp create` document without `scopes`, accepted only
  because the CLI fills in the default the API says it never applies. A
  `--provider` template sets the scopes on purpose (§4).
- **The document is the same on every path.** A connection made with
  `idp create`, written by `auth-method sso enable` or kept in
  `.zitadel/idps/` has one shape. Moving one between the imperative and the
  declarative path is one command: `--dry-run --json` into a file, or `--file`
  from one. Which path a team uses for which provider stays what ADR 064 §1
  says, a decision on its own merits.
- **Nested flag names become contract.** Renaming a nested field renames a
  flag, which ADR 064 already accepts for top-level fields.
- **Large documents mean long help pages.** Grouping by object (§2) keeps them
  readable; the IdP page grows by twenty flags.
- **`resources --json` grows** by every nested leaf, which is its purpose.
- **`user create` makes one more read**, for the user schema (§5).
- **The factory carries more weight.** The collision check (§2), the merge
  order (§1) and the typed `=` (§3) are unit-tested in the factory, and
  `resources.spec.ts` proves they are wired, as
  [`apps/cli/tests/AGENTS.md`](../../apps/cli/tests/AGENTS.md) asks.
- **[`SKILL.md`](../../apps/cli/skills/zitadel-cli/SKILL.md) changes with the
  implementation.** It will tell agents to read `resources --json`, to send a
  nested body as a document with `--file -`, to preview with `--dry-run`, and
  to write references in single quotes.

## Order of work

The parts are independent, and the first unblocks `idp create --data` on its
own:

1. §7, and the merge and send rules of §1. The guard and the redaction stop at
   references and non-strings, a flag over a file merges, and the CLI sends
   what it assembled.
2. The document root, the nested flags and discovery (§1, §2, §9).
3. `--set` and the typed `=` (§3).
4. Asking for and listing missing fields (§6).
5. The `--provider` templates for identity providers (§4).
6. Checking `attributes` against the user schema (§5).

## Open questions

- **The OIDC block reads as optional.** The mirror of the connection in
  [`idp-connection.yaml`](../../api/openapi/endpoints/idps/idp-connection.yaml)
  drops the JSON schema's root `allOf`, in which the protocol requires its
  block, so generated tooling sees `oidc` as optional and its required fields
  as conditional. OIDC is the only protocol, so the mirror could list `oidc` in
  `required` outright, which ogen can express. A second protocol needs a
  discriminator.
- **The `scopes` default.** The mirror gives `scopes` a Zod default, which is
  how the CLI came to inject it. Under §1 the CLI stops sending it, so a
  connection without `scopes` is refused, as the API says. Prefilling them is a
  template's job (§4), not the validator's.
- **`idp update`.** A read-modify-write over `POST /idps` would make changing
  one field a single command. ADR 064 §3 rules out verbs synthesised from other
  calls, though, and `idp.revision_conflict` only refuses two revisions written
  at the same instant, not a lost update.
- **Which schema narrows a template's claim mapping** when a project has
  several user schemas.
- **Comma-separated lists** (`--oidc-scopes openid,email`) are shorter to type,
  but they need an escape for a value that contains a comma.
- **JSON from a file** (`--set claim_mapping:=@claims.json`) is unambiguous,
  because JSON cannot start with `@`. It can be added when someone needs a large
  sub-document.
