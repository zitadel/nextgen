# ADR 061: CLI Resource Commands

> **Status:** Accepted
> **Date:** 2026-09-14
> **Context:** [ADR 007](007-gitops-configuration-surface.md) left runtime resources to server APIs and the [CLI design overview](../design/cli/README.md) reserved "a planned one-shot imperative CLI surface" for them; this ADR is that surface
> **Relates to:** [ADR 004](004-agent-contract-and-agents-md.md), [ADR 007](007-gitops-configuration-surface.md), [ADR 035](035-configuration-environments.md), [ADR 036](036-api-credential-planes.md)

## Decision

**1. Configuration stays declarative; runtime resources become imperative.** A
thing that belongs in git — branding, login flows, schemas — is edited as a
file and shipped through a release ([ADR 035](035-configuration-environments.md)).
A thing that is unbounded or owned by someone other than the developer — a
user, a session, an audit event — gets `zitadel <resource> <verb>` and is never
tracked in `.zitadel/`. This boundary, not the commands themselves, is what
this ADR fixes.

**2. Six resources, and verbs only where an endpoint already exists.** `users`,
`teams`, `sessions`, `events`, `grants`, `projects`. The verb matrix is a
consequence of the API, not a design:

| Resource | Verbs |
|---|---|
| `users` | `list` `get` `create` `update` `delete` |
| `teams` | `list` `get` `create` `update` `delete` |
| `grants` | `list` `get` `create` `delete` |
| `projects` | `list` `get` `update` |
| `sessions` | `list` `get` `revoke` |
| `events` | `list` `get` |

Gaps are the API's gaps. The CLI does not synthesise a missing verb out of
other calls, and it does not hide one that exists.

**3. One registry, one generic factory.** Every command is generated from a
single descriptor table by a factory that knows nothing about Zitadel. Adding a
resource is a table entry; changing a convention changes it everywhere at once.
Hand-authoring a command file per verb is not allowed — that is how surfaces
drift.

**4. The command surface follows the API, not the reverse.** Where the CLI
looks inconsistent because an endpoint is inconsistent — `events` reads through
`GET` while every other list uses `POST /<resource>/query` ([ADR 031](031-openapi-querying.md)) —
the CLI mirrors the deviation and the API is what gets fixed. A CLI that papers
over the shape teaches a shape that is not real.

**5. Credentials never reach a command line.** No flag, argument, or record
entry may carry one; the operator credential is read from
`.zitadel/secret` ([ADR 036](036-api-credential-planes.md)). Shell history and
process listings are readable by other users, so this is enforced in code
rather than documented as advice.

**6. Four facts are contract, not convenience.** Under
`--json` the envelope shape, the exit codes, the error codes, and the cursor
field names are what agents parse ([ADR 004](004-agent-contract-and-agents-md.md),
[ADR 027](027-cursor-based-pagination.md), [ADR 030](030-error-model-mapping-and-reporting.md)).
Changing any of them is a breaking change even though no type signature moves.

## Context

The CLI could already describe configuration but could not create a user. Every
workaround was `curl` against an endpoint whose auth, pagination, and error
shape the developer had to rediscover — so the knowledge lived in shell history
instead of in a tool. The open question was never whether to add these commands
but whether they would be hand-written per resource, which is what makes a CLI
surface diverge from the API it fronts.

## Non-goals

IdP and app management stay experimental under
[ADR 007](007-gitops-configuration-surface.md): their server contracts are not
real yet, and neither is in the registry. This ADR does not change that.

## Consequences

- The API's shape is now visible. A missing verb, an unimplemented filter, or
  an endpoint that deviates shows up as a CLI gap a user can see, which is a
  feature: it turns backend debt into something reported rather than absorbed.
- The registry is a choke point. A careless change to the factory changes every
  resource, so it carries the test weight to match.
- Four contract facts are frozen for agents. They can only change behind a
  deprecation.
- Conventions must be adopted, not re-invented: a new resource that wants its
  own pagination or error shape is a signal the API is wrong, not the CLI.
