---
"@zitadel/server": patch
---

Login identifier lookups now match only uniquely-registered attribute values. Previously, an equal value stored under the same key as a non-unique attribute of another user (for example a notification email address) made the lookup ambiguous and rejected the legitimate user's sign-in.
