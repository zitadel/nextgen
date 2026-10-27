---
"@zitadel/cli": minor
---

`zitadel claim --no-wait` prints the claim link and exits, with `claim_url`, `challenge_id` and `expires_at` under `--json`, so a script or coding agent can hand the link to a person; `zitadel claim --challenge-id <id>` then waits for that link to be used and records the claim.
