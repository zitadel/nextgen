---
"@zitadel/cli": minor
---

Every command now reads, checks and writes `.zitadel/` through one configuration library, so they all hold the files to the same rules and refuse with the same errors.

**Breaking:** `setup` writes the configuration and publishes it in its first deploy instead of creating each resource on its own. When that deploy is refused, `setup` still succeeds, keeps the project and files, and suggests `deploy`. `setup` and the `auth-method` commands refuse when a file under `.zitadel/` does not parse. `auth-method` results report `notices` instead of `kept` and `untouched`. New `.zitadel/state.json` files have no `resources` section. `setup` and `branding eject` replace an outdated `.zitadel/meta/` schema without `--force`. `doctor`'s schema check validates every file under `.zitadel/`. Deploy's lockout check no longer follows a transition into another flow, and a literal `client_secret` is refused by the `connection/literal-secret` rule.
