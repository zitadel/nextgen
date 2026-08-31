---
"@zitadel/server": minor
---

Deployments that opt into the platform plane via `platform.bootstrap_project` guarantee their users a personal team: every session exchange ensures the team and its membership, so a freshly registered developer can complete a project claim without manual seeding, and users created before this change converge on their next sign-in. Standalone deployments that merely pin `platform.project_id` are unaffected.

`platform.bootstrap_project` now seeds a usable project rather than a bare row: encryption and signing keys, the default user schema, and the default login flow definitions are created with it, so a bootstrapped platform project can serve the registration and sign-in the platform plane exists for.
