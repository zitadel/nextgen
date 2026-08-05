---
"@zitadel/server": patch
---

`queryProjects` now requires the `project.write` scope. Its contract still
declared `project.read`, the browser-plane preview secret's scope, which must
not gate an operator read — aligning it with the project management access
model from ADR 036.