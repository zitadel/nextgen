---
"@zitadel/server": minor
---

Unclaimed projects can now only be claimed within 14 days of creation. After that, claim init and complete return 410 `proj.claim_window_expired` (distinct from the retryable `proj.claim_expired` challenge error). Nothing is deleted when the window closes.
