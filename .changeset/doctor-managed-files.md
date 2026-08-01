---
"@zitadel/cli": minor
---

`doctor` now verifies the scaffolded app files. Setup records a scaffold manifest (per-file content hash and ownership class) in `.zitadel/state.json`; the new `managed-files` check fails when an infrastructure file (request boundary, `custom-elements.d.ts`) is missing, warns on a missing generated page, and classifies edited or user-adopted files without failing them. `doctor --fix` restores missing managed files and — across all checks, including the dependency repair — never replaces an existing scaffolded app file, edited or not; additive repairs (gitignore entries, env keys, the SDK dependency) stay idempotent. Apps scaffolded by older CLI versions are checked against template-derived expectations until their next setup.
