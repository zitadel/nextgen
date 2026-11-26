---
"@zitadel/components": patch
---

The hidden username field that `<zitadel-login>` renders on the password step now has an `id`. Chrome's Issues panel no longer reports it as a form field with neither an id nor a name, and the field stays out of the submitted fields.
