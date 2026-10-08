---
"@zitadel/components": patch
---

Fix the spacing on a completed login step (the "You're signed in" terminal screen): the centred heading no longer sits flush against the action buttons. The terminal card kept a zero gap intended for a body-less screen, which collapsed the space once the empty field group was hidden; it now uses the card's standard heading-to-content gap.
