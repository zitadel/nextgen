---
"@zitadel/server": minor
---

Deployments that opt into the platform plane via `platform.bootstrap_project` guarantee their users a personal team: every session exchange ensures the team and its membership, so a freshly registered developer can complete a project claim without manual seeding, and users created before this change converge on their next sign-in. Standalone deployments that merely pin `platform.project_id` are unaffected.

`platform.bootstrap_project` now seeds a usable project rather than a bare row: encryption and signing keys, the default user schema, and the default login flow definitions are created with it, so a bootstrapped platform project can serve the registration and sign-in the platform plane exists for.

**Upgrade note for existing `platform.bootstrap_project` deployments.** The previous bootstrap created the platform project as a bare row with none of that, and there is no way to seed one in place yet. The server therefore refuses to start when it finds a platform project without an active token encryption key, rather than booting into a project that cannot serve a registration. If you hit this, unset `platform.bootstrap_project` to start with the pre-upgrade behaviour, and track in-place seeding under #527. Do not delete the platform project to force a reseed: deletion cascades to its users, teams, schemas, sessions, and grants.
