---
"@zitadel/cli": minor
---

`zitadel claim --no-wait` prints the claim link and exits instead of waiting for the browser step, so a script or coding agent driving `--json` gets the link to hand to a person: the result carries `claim_url`, `challenge_id` and `expires_at`. `zitadel claim --challenge-id <id>`, which the result suggests, then waits for that link to be used and records the claim, without creating a new link.
