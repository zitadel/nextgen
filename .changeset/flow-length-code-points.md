---
"@zitadel/server": patch
---

Login and registration fields now measure `minLength` and `maxLength` in characters, as the user schema does, rather than in bytes. A value with accented letters or emoji could previously pass a minimum length while being too short, and a name at its maximum length was rejected before reaching it.
