---
"@zitadel/server": minor
---

Deployments that opt into the platform plane via `platform.bootstrap_project` guarantee their users a personal team: registration through the login flow (password and passkey alike) ensures the team and its membership, and every session exchange self-heals accounts that missed it — including users created before this change. Freshly registered developers can therefore complete project claims without manual seeding. Standalone deployments that merely pin `platform.project_id` are unaffected.
