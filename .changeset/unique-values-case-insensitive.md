---
"@zitadel/server": patch
---

Unique attribute values are now compared case-insensitively (Unicode case folding): `Alice@Example.com` and `alice@example.com` register as one unique value and resolve to the same user at sign-in regardless of typed casing. Stored attribute values keep their original casing.
