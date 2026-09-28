---
"@zitadel/cli": minor
---

Manage the variables and secrets a configuration document references as `${{ NAME }}` from the CLI with `zitadel variables list|get|set|delete`. Every command names the owner it addresses with `--project-level`, which is required: a run that names none is refused rather than defaulted. The platform also holds variables per environment; the CLI addresses those once the platform's environments settle.
