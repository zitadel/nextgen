---
"@zitadel/server": minor
---

Projects now carry **environments** — the runtime slots a release is deployed onto (ADR 035). Two read endpoints ship: `GET /environments` lists a project's environments in pipeline order, and `GET /environments/{name}` reads one by its project-unique name, which is the handle a deploy target is already known by.

Environments are identity only for now: `{ id, project_id, name, created_at }`, with no link to a release yet. Because there is no create endpoint, every project — new or created through the CLI — is seeded with `dev`, `staging` and `prod` at creation, and the set cannot be changed until environment lifecycle lands. Existing projects are not backfilled.

Seeding emits one `environment.created` audit event per environment.
