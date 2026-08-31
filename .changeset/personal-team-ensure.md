---
"@zitadel/server": minor
---

Deployments that opt into the platform plane via `platform.bootstrap_project` guarantee their users a personal team: every session exchange ensures the team and its membership, so a freshly registered developer can complete a project claim without manual seeding, and users created before this change converge on their next sign-in. Standalone deployments that merely pin `platform.project_id` are unaffected.
