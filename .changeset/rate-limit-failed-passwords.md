---
"@zitadel/server": minor
---

Repeated wrong passwords for one user are now slowed down. The first 5 wrong passwords within 24 hours are free; each one after that makes the next check of that user's password wait 30 seconds longer after it, up to 15 minutes. A wrong password stops counting after 24 hours and a correct password clears them, so no administrator has to unlock anyone. While a check is held back it is rejected the same way as a wrong password, even when the password is correct. The limits apply to every project and cannot be configured.
