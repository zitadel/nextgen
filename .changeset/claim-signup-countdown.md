---
"@zitadel/server": minor
"@zitadel/config": minor
---

Land the claim page on sign-up with a claim-window countdown, drop passkeys from the shipped default login flow, and fix three sign-in surface defects found in design QA.

A developer opening a claim link from `zitadel claim` normally has no account on the deployment yet, so the claim page now enters the flow with `purpose="register"`; the register step's own `sign_in` action carries the returning developer back. Beside every state of that page it shows how long the project can still be claimed, read from the new unauthenticated `GET /projects/{project_id}/claim/window?challenge_id=...`, so an expired claim *link* no longer reads as an expired *project*. The sign-in widget grows an `attribution-trailing` slot for it: the design has always drawn a badge beside the "Secured with Zitadel" trustmark, and the widget could not fill it because nothing on a flow response carries a duration — a host that has one can now put it there, and an embed that ignores the slot renders exactly as before.

The shipped `password-first` login flow no longer offers `passkey` on `identifier`/`password` or `passkey_register` on `register` — the passkey legs proved unreliable in testing, and the `passkey-first` preset remains the way to offer them.

Three fixes to the sign-in surface itself: the alert's error icon keeps its 16px size and centres on the first line of text instead of shrinking under a long message and floating above a short one; a terminal step that is about to navigate no longer paints a "you are signed in" screen the host immediately replaces, so one sign-in produces one confirmation; and the sign-up card gains the subtitle every other step already had.
