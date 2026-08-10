---
"@zitadel/cli": minor
---

Report whether a project is attached to a team in `setup`, `status`, and `doctor`, so the temporary nature of a fresh project is visible without having to know `zitadel claim` exists.

`setup` closes with an ownership line and points at `claim`, `status` carries `data.project.claim` (`detached`, or `attached` with the owning `team_id` and `claimed_at`), and `doctor` grows a `claim` check. All three read `claimed_at`/`team_id` from `.zitadel/secret`, which `zitadel claim` already writes, so nothing here costs a platform call and everything keeps working offline.

A project with no team is a **warning**, never a failure: it works exactly like one with a team, so `doctor` still exits 0, and `--fix` deliberately does nothing because claiming needs a human in a browser. The messaging frames unattached projects as temporary without promising deletion, since nothing deletes them today.

Nudges appear only for projects whose `server` in `zitadel.json` is the Zitadel cloud. Local and self-hosted projects have no team to attach to, so `zitadel setup --server local` stays quiet about it.
