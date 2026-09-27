---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/config": minor
---

A flow step now names the identity providers it offers by connection slug: `"sso_providers": ["google"]` instead of `[{ "id": "google", "name": "Google", "template": "google" }]`. The connection under `.zitadel/idps/` owns the display name and template, so renaming a provider there reaches every step without editing the flow. The flow definition API, the editor schema and stored revisions all take the slug list together, and revisions stored with the object form still load, each object read as its `id`. The step the login page receives is unchanged and still carries `{id, name, template}` objects.

**Breaking:** creating a flow definition with `sso_providers` objects now fails with a 400, and a definition read back lists slugs instead of objects. Send the connection slug in place of each object. No shipped flow uses `sso_providers` and the engine does not act on it yet, so nothing that works today stops working.
