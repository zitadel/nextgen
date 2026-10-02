---
"@zitadel/server": minor
"@zitadel/api": minor
---

Passwords are now Unicode-normalized (NFC) before they are hashed or checked, so a user signs in with the same characters however their keyboard composed them. A password can be at most 64 characters, counted as Unicode characters rather than bytes, and is never truncated. Setting an empty or longer password fails with `user.password_empty` or `user.password_too_long` (400) instead of being accepted. Projects that hash with bcrypt also get `user.password_too_long` for a password over bcrypt's 72-byte limit, where they previously got a 500.
