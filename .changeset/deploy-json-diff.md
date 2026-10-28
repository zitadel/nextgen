---
"@zitadel/cli": minor
---

`zitadel deploy --dry-run --json` now reports what the deploy would change, so a script or an agent can review it before deploying: `data.diff` lists each changed file under `.zitadel/` with its status and its part of the diff the terminal shows, against the release your primary origins serve. `zitadel deploy --json` reports the same diff for what it deployed.
