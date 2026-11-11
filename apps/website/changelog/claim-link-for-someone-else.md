---
title: Hand the claim link to someone else
summary: zitadel claim --no-wait prints the claim link and exits, so a script or coding agent can pass it to a person, and claim --challenge-id waits for it to be used.
date: 2026-10-27T23:26Z
pulls: [2402]
---

`zitadel claim --no-wait` prints the link that claims a project and exits, with `claim_url`, `challenge_id` and `expires_at` under `--json`, so a script or coding agent can hand the link to a person. `zitadel claim --challenge-id <id>` then waits for that link to be used and records the claim.

[zitadel claim](https://preview.zitadel.com/docs/reference/cli/claim)
