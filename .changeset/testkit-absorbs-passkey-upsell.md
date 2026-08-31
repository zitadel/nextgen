---
"@zitadel/testing": minor
---

`registerWithPassword` now clears the passkey upsell the default flow shows after a password is set, so a caller still lands on their signed-in surface rather than on an intermediate step. Suites that added their own skip handling after `registerWithPassword` should drop it — the two race each other. A flow that routes `register-password` straight to `done` is unaffected: the helper only clicks a `skip` action that is actually rendered, and never waits for one.
