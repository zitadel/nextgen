---
"@zitadel/cli": patch
---

`zitadel doctor` now checks the editor schemas in `.zitadel/meta/`. A project set up with an older CLI lacks the dialects added since and holds the others in their old version, so a file's `$schema` can point at nothing and editors validate against outdated rules. `doctor` warns about missing or outdated files, and `doctor --fix` writes the current version's; a file that differs only in the CLI version it names is not outdated, and other files in the folder are left alone. `branding eject` writes `.zitadel/meta/branding.json` in the same form as `setup`, and replaces an outdated one. A CLI older than the version the project pins its `@zitadel/*` packages to reports the difference and writes nothing.
