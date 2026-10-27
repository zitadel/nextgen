---
"@zitadel/cli": patch
---

If you set up your app with `zitadel` 0.1.0, run `zitadel doctor --fix` once before your first `zitadel deploy`. 0.1.0's `zitadel setup` registered the app's URL as a preview origin, but `zitadel deploy` only deploys to primary origins, so it failed with "The project has no primary origin to deploy to", and the suggested `zitadel origin add <url> --kind primary` was refused because the URL was already stored as a preview origin. `zitadel doctor` now warns about such a project, and `zitadel doctor --fix` makes the URL a primary origin. When a project has no primary origin, `zitadel deploy` now suggests the step that works for it: `zitadel doctor --fix` for a project 0.1.0 set up, or `zitadel origin add` with the app's URL otherwise.
