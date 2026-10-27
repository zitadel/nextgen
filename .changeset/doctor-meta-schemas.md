---
"@zitadel/cli": patch
---

`zitadel doctor` now warns when the editor schemas in `.zitadel/meta/` are missing or outdated, which leaves a file's `$schema` pointing at nothing or at old rules, and `doctor --fix` writes the current ones; `branding eject` writes `.zitadel/meta/branding.json` the same way.
