---
"@zitadel/server": patch
---

The server now keeps a user's previous passwords, as hashes, whenever the password changes, so a password policy can later refuse a password the user already used.
