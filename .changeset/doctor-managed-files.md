---
"@zitadel/cli": minor
---

`doctor` now verifies the scaffolded app files. Setup records a scaffold manifest (per-file content hash and ownership class) in `.zitadel/state.json`; the new `managed-files` check fails when an infrastructure file (request boundary, `custom-elements.d.ts`) is missing, warns on a missing generated page, and classifies edited or user-adopted files without failing them. `doctor --fix` restores missing managed files and — across all checks, including the dependency repair — never overwrites an existing file, edited or not. Apps scaffolded by older CLI versions are checked against template-derived expectations until their next setup.
