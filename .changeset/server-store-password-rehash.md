---
"@zitadel/server": minor
---

A successful password sign-in now replaces an outdated stored hash with one written by the project's password hashing method, so imported bcrypt or legacy hashes move to argon2id, or to the method the project chose, as users sign in. A project whose method is bcrypt keeps bcrypt. If the new hash cannot be stored, the sign-in still succeeds.