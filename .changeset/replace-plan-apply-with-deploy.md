---
"@zitadel/cli": minor
"@zitadel/server": minor
"@zitadel/api": minor
---

Replace `plan` and `apply` with `deploy`. `deploy` builds the files under `.zitadel/` into one immutable release, validates them, shows a git diff of your config against the release that is live now, then makes the release live on the project's primary origins. `deploy --dry-run` validates and shows the diff without publishing anything, and re-running `deploy` on unchanged config changes nothing.

New commands manage releases and deployments directly: `release create` builds a release without deploying it, `release revoke` stops a release from ever being served again, `deployment create` deploys an existing release, `deployment list` and `deployment get` read the history, and `deployment rollback` re-applies an earlier deployment (bare, it undoes the last deploy).

**Breaking:** `plan` and `apply` are removed. Use `deploy --dry-run` where you ran `plan`, and `deploy` where you ran `apply`. The generated `releases list` and `releases get` are now `release list` and `release get`, beside `release create` and `release revoke`. Add the origins your project serves with `origin add` before the first deploy — `deploy` needs at least one primary origin. A server refusal because of the state it holds (an HTTP 409) now fails every command with `E_CONFLICT` (exit 5) rather than `E_VALIDATION` (exit 3), and a target the project does not hold as an origin fails with `E_VALIDATION` rather than `E_AUTH`.

**Upgrading a project set up with 0.1.0:** its app URL is registered as a preview origin only, so its first `deploy` fails with "The project has no primary origin to deploy to". Make that URL primary, as `zitadel setup` now does: find it with `zitadel origin list`, remove it with `zitadel origin rm <url>`, add it back with `zitadel origin add <url> --kind primary`, then deploy. Adding it again without removing it fails, because the URL is already stored as a preview origin.

`@zitadel/api` adds the client operations behind these commands: creating a release, deploying it, listing and reading deployments, rolling one back, and revoking a release.
