---
"@zitadel/server": minor
---

Flag-gated platform project bootstrap: setting `platform.bootstrap_project: true` (env `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT`) makes the server idempotently ensure the project pinned by `platform.project_id` exists at startup. Off by default.
