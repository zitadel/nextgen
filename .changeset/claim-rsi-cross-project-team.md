---
"@zitadel/server": patch
---

Allow the claimed project's resource-scope row to reference the claiming team's home project: the claim (ADR 046) attaches a platform-project team to a claimed project, which the previous same-project foreign key rejected, so every claim/complete failed. The FK now routes through a new team_project_id column, with CHECK constraints keeping every other row kind same-project and the pair complete.
