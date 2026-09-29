---
"@zitadel/server": patch
---

The console no longer selects a project you cannot manage. When you open it without a project selected, it picks your only project, or asks you to choose on the Projects screen. It no longer falls back to the project the console signs into, which on a deployment with a platform project is the platform project: after a claim, the console used to land there and answer "unauthorized" on Project settings.
