# ADR 061: Per-Environment Variables and Secrets

> **Status:** Proposed
> **Date:** 2026-09-04
> **Context:** How a configuration value that must differ per environment
> reaches a running release, and how the sensitive half of those values is
> protected.
>
> Outcome of [#967](https://github.com/zitadel/nextgen/issues/967) (Environments
> - Variables), part of [#528](https://github.com/zitadel/nextgen/issues/528).
>   Unblocks [#851](https://github.com/zitadel/nextgen/issues/851) (IdP
>   connections), which is the first consumer.
>
> **Builds on** [ADR 035](035-configuration-environments.md) (a release is
> promoted between environments unchanged; environments are runtime slots),
> [ADR 029](029-cryptography-secrets-and-key-lifecycle.md) (envelope encryption,
> per-project keys).
>
> **Deviates from** [ADR 047](047-dialect-id-generation.md) §Prefix registry: a
> variable has no minted PK (§6).

## Context

A release pins a revision of every configuration resource and is deployed to any
environment unchanged (ADR 035). A value that has to differ per environment
therefore cannot live inside the release, and there is nowhere else for it to
go today.

IdP connections are the first case that cannot be expressed at all. A project
registers a separate OAuth client per environment, so both the client id and the
client secret differ between them: one public, one sensitive, both required
before the connection can be used. `docs/design/idp/schemas/github.json` shows
the shape the resource wants:

```json
{
  "client_id": "${{ GITHUB_CLIENT_ID }}",
  "client_secret": "${{ GITHUB_CLIENT_SECRET }}"
}
```

These are **not** operating-system environment variables. They are values the
developer sets on their own project's environments, stored there, and resolved
when a request is served on that environment. GitHub Actions is the closest
parallel: a repository declares environments, each holding its own values, and
one unchanged workflow reads them per environment.

## Decision

### Format

Customers can enter variables in their configuration files using a handlebar
notation like so:

```plain
${{ MY_VARIABLE }}
```

The whitespace between the handlebars and variable name are insignificant. The
name of a variable must only contain characters, numbers or underscores.
Regex: `^\w+$`

Variables do not have to contain the entire field value, so substitution is
possible. This is not possible for secrets. Secrets need to replace the whole
value.

There is no namespace like `vars` or `secrets`. All variables are stored in a
flat table, so adding a namespace would only add unnecessary routing.

This results in for example an IDP document to read like:

```json
{
  "endpoint": "https://${{ ENVIRONMENT_NAME }}.my-custom-idp.com",
  "client_id": "${{ MY_CLIENT_ID }}",
  "client_secret": "${{ MY_CLIENT_SECRET }}"
}
```

There are five ways a value can be rendered:

1. **Not a variable**: Nothing to do. The field value is rendered as is.
2. **Entire field value**: The entire field-value is replaced with the value of
   the variable, JSON-encoded
3. **Partial field value**: Only the placeholder is replaced with the value of  
   the variable, JSON-encoded
4. **Secrets only replace as a whole**: For secrets no partial substitution is
   allowed. So the entire field value is replaced with the value of the secret.
5. **Non-existing variable**: Nothing to do, the field value is rendered as is.
   We assume this was done on purpose.

#### Examples

| Example                                   | Variable value | Result                            |
|:------------------------------------------|:---------------|:----------------------------------|
| `"client_id": "abcd1234"`                 |                | `"client_id": "abcd1234"`         |
| `"retry_count": "${{ RETRY_COUNT }}"`     | 5              | `"retry_count": 5`                |
| `"client_id": "${{ CLIENT_ID }}"`         | 4321dcba       | `"client_id": "4321dcba"`         |
| `"timeout": "${{ TIMEOUT_SECONDS }}s"`    | 10             | `"timeout": "10s"`                |
| `"client_secret": "${{ CLIENT_SECRET }}"` | password1234   | `"client_secret": "password1234"` |

### Scope

The scope of a variable is defined by the creator of the variable. Currently,
that scope is composed of the project-ID and environment-name. The combination
of scope and variable-name is unique, meaning "project-A" can have only one
"MY_VARIABLE" on each of its environments.

Once deployments land, this scope should be expanded to optionally contain the
deployment-ID. That way the variables in a deployment are snapshot and cannot
accidentally be changed by modifying a variable of another deployment.

In the future there will probably be a need for more levels in the scope. E.g.:
configuration at a team/user-schema level. These are deliberately left out at
the moment because it is cheap to add them later but adding them now would
ask additional questions on how variables are resolved. More on that in
the [resolving variables section](#resolving-variables).

Since a variable is unique by its name and scope, no other identifier is needed.

### Resolving variables

Depending on the variable-name, project-ID and environment name a variable can
be resolved. This is done by an exact match: variable-name, project-ID and
environment name need to match the variables scope and name.

Once more scope levels/values are allowed another model might be necessary here
to allow for inheritance over multiple levels. E.g.: A variable defined at a
project level will automatically be applied on team/user-schema level without
having to specify the ids. This is out of scope however and will need attention
once that usecase is needed.

### Storage

Variables and secrets are stored in a single table with a `BIT` indicating
whether it is a secret or not. This allows for a flexible storage model in
which fast lookups can be done using their scope and variable names.

Secrets are stored encrypted using the projects secret encryption key, as
described in [ADR029](./029-cryptography-secrets-and-key-lifecycle.md).
Decryption happens with the secret that encrypted the value. Because of key
rotation, that can be different keys.

### API

Variables and secrets can be managed using `PATCH`/`GET`/`DELETE` endpoints on
the api. There are no separate endpoints for secrets since they exist in the
same storage so separating them out in the api would only create a
mental/syntax overhead.

`PATCH` accepts a JSON-document in which the variables are listed to patch.
The keys of the document are the variable names, the values are either a
JSON scalar (string, number, boolean) or an object with which it is possible
to mark a variable as secret.

`GET` returns the JSON-document with all the variables stored for the requested
scope. The filter currently represents the project-ID and environment name.
Scopes can be added later once a need for them pops up. The values of secrets
are never returned. The key exists in the document with as value
`{"isSecret": true}` to indicate that the variable is present.

`DELETE` removes a variable. This is needed because `PATCH` can only add/update
variables. The variable name and scope of the variable to delete are provided
with the request.

### Permissions

There are two permissions. One to read variables, one to write variables. No
distinction between secrets or variables. However, as described in [API](#api),
a secret can never be read back.

### Runtime integration

Internally a `VariableService` provides all functionality to set, retrieve and
replace variables. When a part of the application needs some variable (s) and/or
secret (s) it can request these from this service. Some functions are provided
for different use-cases:

Modifying functions:

- `SetVariables`: Saves a variable to the database. It encrypts the value if the
  variable is a secret.
- `DeleteVariable`: Removes a variable from the database.

Querying functions:

- `GetVariables`: Fetches variables by name, from the database, but does not
  decrypt them if they are secret. These are the variables as stored in the
  database.
- `GetDecryptedVariables`: Fetches variables by name, from the database and
  decrypts them so that they can be used to for example authenticate against
  an external IDP.
- `ReplaceVariables`: Takes a `map[string]any` document in which it replaces
  all values according to the rules described in the [format section](#format).

Which function is a case needs, is up to the developer. However, none of the
outputs of these functions should blindly be returned to the user. All of the
querying functions return data which is not supposed to be leaked outside the
applications (so also not to logs).

This per use-case resolvent of variables is intentional. Another approach would
be to resolve all variables in a middleware. This would make fetching variables
in a later stage fast, but adds a big cost for each request. Certainly for
secrets, for which each a decryption key needs to be resolved and the value
decrypted. In projects with only a few variables this is no problem, but once
projects will get a lot of secrets, this might become a bottleneck.

To ensure a small document does not render an enormous response some rules need
to be set:

| Limit            | Value              | Description                                                                                     |
|------------------|--------------------|-------------------------------------------------------------------------------------------------|
| Value size       | 16 KiB per string  | What is the maximum size of one variable.                                                       |
| Expansion budget | 1 MiB per document | How large can a document be in total.                                                           |
| Document depth   | 20                 | How many levels deep can we search for variables. This is done to eliminate infinite recursion. |

### What this ADR does not decide

- **Fine-grained permissions.** Those endpoints sit behind the same
  project-scoped check as every other management resource, gated on
  `variable.read` / `variable.write`.
- **Deployment validation.** When a deployment is created, some validation
  needs to happen to ensure variables are present.

## Alternatives considered

**A field-name twin per referencing field** (`client_secret_env` beside
`client_secret`, as sketched in #967). Rejected: every field that might
reference a value needs a second field, the schema doubles, and a value can only
be referenced where someone anticipated it.

**Namespaced references** (`${{ secrets.X }}` / `${{ vars.X }}`, or
`${env.X}`). Rejected: with one store and one flat name space the prefix routes
nothing, and it makes the reference depend on a flag that belongs to the value.
Note the cost: a document author cannot see from the reference whether a value
is sensitive, and the name grammar (`\w+`) would have to widen before a
namespace could be adopted later.

**Separate mechanisms for secrets and variables.** Deferred rather than
rejected: it is the honest answer to read-back and deploy diffs (§10), but it
doubles the surface before there is an API to double, and the encryption flag
already gives the two different storage behavior.

**An owner hierarchy** (an environment inheriting the project's variables, the
narrowest owner winning). Deferred rather than rejected, for the reason in §4:
it makes a read return several rows per name, which needs a rule for choosing
between them, which every reader then has to apply the same way. It is the
better answer for a value that should hold everywhere, and §10 keeps that case
open; it is not something to carry before there is a case for it.

**Operating-system environment variables.** Out of scope by the issue: these are
project data, set through Zitadel, read on the environment serving the request.
