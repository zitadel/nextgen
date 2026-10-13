---
"@zitadel/server": minor
"@zitadel/config": minor
"@zitadel/cli": patch
"@zitadel/testing": patch
---

A flow definition names its user schema by `objectType` and runs against the project's newest revision of it. `POST /flow_definitions` still accepts a schema id and stores the `objectType` it names, so reading a definition back returns the `objectType`.

The default login flows name `human-user`, and `getDefaultLoginFlow` no longer takes `userSchemaUrl`. `zitadel sso enable` finds a flow that names its schema by `objectType`, and the console links a flow to the revision it runs against.
