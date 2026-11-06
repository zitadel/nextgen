---
"@zitadel/cli": patch
---

`zitadel setup` now creates a new app in a folder whose name is not a valid npm package name, such as one made by `mktemp -d`, instead of stopping with `Fresh app directory name … is not npm-package-safe`. The app is generated in a subfolder with a valid name and moved up into the folder.
