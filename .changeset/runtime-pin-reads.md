---
"@zitadel/server": minor
---

A sign-in that resolves to a release now uses the user schema, branding, and identity provider revisions that release pins, instead of the newest revision of each. A release that pins a flow and no branding serves the built-in login branding. SSO client credentials come from the variables frozen with that sign-in's deployment. A sign-in with no release still uses the newest revisions and the project's current variables.
