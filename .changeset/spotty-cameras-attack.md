---
"@zitadel/server": minor
---

Unclaimed projects can now only be claimed within 14 days of creation. After that, claim init and complete return 410 `proj.claim_window_expired` (distinct from the retryable `proj.claim_expired` challenge error), and claim status reports the same final 410 for a pending challenge, taking precedence over challenge expiry so polling clients stop suggesting a futile retry. The claim grant is the status route's source of truth: a project claimed through another concurrent challenge reports `completed` with its owning team, never a false expiry verdict. Nothing is deleted when the window closes.

Separately, default-project resolution (the console runtime document and the bare hosted login) now skips the built-in platform project in its first-created heuristic: a deployment that once ran with `platform.bootstrap_project` and later disabled it resolves its first real project instead of the leftover platform row. Explicit `platform.project_id` configuration is unchanged.
