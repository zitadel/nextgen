---
"@zitadel/components": minor
"@zitadel/server": minor
---

Sign-up forms now follow the project's password policy. On a step where the user chooses a password, the password field carries the policy's `min_length` and `max_length` (the 64-character cap when the policy sets no maximum), and a password outside them is refused on that step. The field's fixed minimum of 8 is gone: a project without a password policy has no minimum. A sign-in step carries no length rule, so a password set before a stricter policy still signs in. The login shows the bound in its message, for example "Password must be at least 12 characters."
