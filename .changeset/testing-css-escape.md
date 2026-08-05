---
"@zitadel/testing": patch
---

Escape control characters in flow action names before CSS attribute-selector
interpolation, following the CSSOM string-serialization rules. Previously only
quotes and backslashes were escaped, so an action name containing a newline or
other control character could invalidate `flowAction`'s whole selector union.
