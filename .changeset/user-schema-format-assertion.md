---
"@zitadel/server": minor
---

User attributes are checked against the `format` keyword of their schema. A value that does not match, such as an email without a domain, is rejected on `POST /users`, on `PATCH /users/{user_id}`, in a login or register step, and when a social sign-in provider's verified claim would create a user unattended. Before, `format` was ignored and the value was stored.

**Breaking:** every format the schema names is asserted, not only `email`: `date`, `uri`, `uuid` and the other formats JSON Schema defines. `email` takes one bare address, exactly as written, with an ASCII domain: surrounding spaces, a display name, a quoted local part or a non-ASCII domain are refused, where a step used to accept any value with one `@`. Use `idn-email` for a property that takes non-ASCII domains. No step input produces a `date-time` or `time` value, since the date input submits the date alone, so a property of either format cannot be collected by a step. A stored value that fails its format blocks `PATCH /users/{user_id}` until the patch corrects it; check existing users' attributes against their schema before upgrading.
