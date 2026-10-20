---
"@zitadel/cli": patch
"@zitadel/config": patch
---

Editors no longer flag `zitadel.json` for an unreachable schema. `zitadel setup` now writes the schema of `zitadel.json` to `.zitadel/meta/project.json`, next to the flow and user-schema dialects, and points the file's `$schema` at it, so editors validate the project configuration offline instead of trying to load `https://schemas.zitadel.com/v2/project.schema.json`, which never existed. In a project set up earlier, delete the `$schema` line from `zitadel.json` to silence the warning; only editors read it.
