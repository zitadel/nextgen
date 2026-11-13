---
"@zitadel/config": patch
---

The `.zitadel/policies/README.md` that `zitadel setup` writes no longer says a user can change their own password: `history_depth` is checked only then, which no sign-up or API call does yet. It also shows `max_length`'s lower bound as `min_length`, links the NIST guidance, and links the new guide, [Set the password policy](https://preview.zitadel.com/docs/guides/password-policy).
