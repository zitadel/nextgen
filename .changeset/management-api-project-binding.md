---
"@zitadel/server": minor
"@zitadel/api": minor
---

The management API (schemas, flow definitions, users, teams, project
queries — the operator plane of ADR 036) now enforces the access model
settled for branding in ADR 037, closing two holes:

- **Project binding with anti-oracle responses.** Every management
  operation requires the bearer to be bound to the requested project;
  before, any project's secret could read and write any other project's
  schemas, flow definitions, users, and teams (including setting user
  passwords). Foreign projects answer exactly like nonexistent ones, so
  project ids cannot be probed.
- **The browser plane is locked out.** The preview secret ships to
  visitors' browsers by design (`project.read` only); it can no longer
  call any management operation — previously it could create schemas,
  manage flow definitions, list users, and set passwords. Denials are
  `403 <resource>.permission_denied`.

Contract fixes that ride along: `createTeam` was declared `security: []`
(callable with no credential at all) and now requires the bearer with
`team.write`; the drifted `users.read`/`teams.read` scope names are
normalized to `user.read`/`team.read`; the oauth2 scheme's scope
registry now lists the team and flow-definition scopes. `project.write`
implies the finer per-resource scopes until ADR 036's credential planes
make them mintable.
