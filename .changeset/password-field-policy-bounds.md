---
"@zitadel/components": minor
"@zitadel/server": minor
---

Where the user chooses a password, the login's password field now follows the project's password policy, its `min_length` and its `max_length` or the 64-character cap, and refuses a password outside them with the bound in the message. The fixed minimum of 8 is gone, so a project without a policy has none; sign-in steps carry no length rule.
