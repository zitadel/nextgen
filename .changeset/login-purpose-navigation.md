---
"@zitadel/server": patch
"@zitadel/config": patch
"@zitadel/api": patch
---

Preserve purpose across in-card navigation: a flow transition can declare a
local `purpose` (`{"target": "register", "purpose": "register"}`), and taking
it moves the flow's dispatch mode while the original purpose stays pinned.
The default login flow (and the passkey-first preset) now ship visible
"Sign up" / "Sign in" navigations on their entry steps built on this —
previously the only in-card path to registration was submitting an unknown
email. Validators (server-side and `@zitadel/config`) enforce that the purpose
is one the definition serves, that the transition targets that purpose's entry
step, and that `purpose` never combines with the cross-flow `action`. Navigate
actions now also clear a pending passkey challenge, so an abandoned prompt
cannot re-attach after navigating away.

Existing scaffolded apps keep their local `.zitadel/flows/default-login.json`
unchanged (local config stays authoritative). To adopt the in-card
navigations, add the two navigate actions and their purposed transitions to
your flow file — or re-eject the default — then `zitadel plan` / `apply`.
