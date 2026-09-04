---
"@zitadel/server": minor
---

Unclaimed projects can now only be claimed within 14 days of creation. After that, claim init and complete return 410 `proj.claim_window_expired` (distinct from the retryable `proj.claim_expired` challenge error), and claim status reports the same final 410 for a pending challenge, taking precedence over challenge expiry so polling clients stop suggesting a futile retry. Nothing is deleted when the window closes.
