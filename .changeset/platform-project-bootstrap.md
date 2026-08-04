---
"@zitadel/server": minor
---

Flag-gated platform project bootstrap: setting `platform.bootstrap_project: true` (env `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT`) makes the server idempotently ensure the built-in platform project (`proj_platform`) exists at startup and resolves it as the default. Off by default; needs no `platform.project_id`. `platform.project_id` remains the standalone pin to an existing project and, when set, must be a `proj_`-prefixed id.
