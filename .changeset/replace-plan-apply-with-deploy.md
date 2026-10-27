---
"@zitadel/cli": minor
"@zitadel/server": minor
"@zitadel/api": minor
---

`zitadel deploy` replaces `plan` and `apply`: it builds `.zitadel/`, identity provider connections included, into one immutable release, shows its git diff against the live one, and makes it live on the project's primary origins ([guide](https://preview.zitadel.com/docs/guides/deploy)). New `release` and `deployment` commands, and their `@zitadel/api` operations, create, list, deploy, roll back and revoke releases directly; a rollback lists the revisions it restores.

**Breaking:** `plan` and `apply` are removed. Use `deploy --dry-run` where you ran `plan`, and `deploy` where you ran `apply`. The generated `releases list` and `releases get` are now `release list` and `release get`, beside `release create` and `release revoke`. Add the origins your project serves with `origin add` before the first deploy — `deploy` needs at least one primary origin. A server refusal because of the state it holds (an HTTP 409) now fails every command with `E_CONFLICT` (exit 5) rather than `E_VALIDATION` (exit 3), and a target the project does not hold as an origin fails with `E_VALIDATION` rather than `E_AUTH`.

**Upgrading a project set up with 0.1.0:** its app URL is registered as a preview origin only, so its first `deploy` fails with "The project has no primary origin to deploy to". Run `zitadel doctor --fix` once to make that URL primary, as `zitadel setup` now does; `zitadel doctor` warns about such a project, and `deploy` suggests the fix. To do it by hand, find the URL with `zitadel origin list`, remove it with `zitadel origin rm <url>`, add it back with `zitadel origin add <url> --kind primary`, then deploy. Adding it again without removing it fails, because the URL is already stored as a preview origin.
