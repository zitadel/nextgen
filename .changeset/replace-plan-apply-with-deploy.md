---
"@zitadel/cli": minor
"@zitadel/server": minor
"@zitadel/api": minor
---

Replace `plan` and `apply` with `deploy`. `deploy` builds the files under `.zitadel/` into one immutable release, validates them, shows a git diff of your config against the release that is live now, then makes the release live on the project's primary origins. `deploy --dry-run` validates and shows the diff without publishing anything, and re-running `deploy` on unchanged config changes nothing.

New commands manage releases and deployments directly: `release create` builds a release without deploying it, `release revoke` stops a release from ever being served again, `deployment create` deploys an existing release, `deployment list` and `deployment get` read the history, and `deployment rollback` re-applies an earlier deployment (bare, it undoes the last deploy).

**Breaking:** `plan` and `apply` are removed. Use `deploy --dry-run` where you ran `plan`, and `deploy` where you ran `apply`. Add the origins your project serves with `origin add` before the first deploy — `deploy` needs at least one primary origin.

The release and deployment endpoints ship as part of this change (`@zitadel/server`), along with the generated client operations the CLI drives them through (`@zitadel/api`): creating a release, deploying it with an optimistic-concurrency guard, listing and reading deployments, rolling one back, and revoking a release.
