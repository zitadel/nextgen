---
"@zitadel/server": patch
---

User attributes are checked against the `format` keyword of their schema. A value that does not match, such as an email without a domain, is rejected on `POST /users`, on `PATCH /users/{user_id}`, in a login or register step, and when a social sign-in provider's verified claim would create a user unattended. Before, `format` was ignored and the value was stored.

**Breaking:** every format the schema names is enforced, not only `email`. A user schema using `date`, `uri`, `uuid` or another registered format now rejects values that do not match it.
