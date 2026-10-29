---
"@zitadel/server": minor
---

With platform bootstrap on, the platform project is deployed like any project: it is created with its keys only, and every start builds the bundle the server ships (the platform user schema and the default login flows) into a release and deploys it to `server.public_base`'s origin, which the platform project lists as a primary origin. Console sign-in is served that release, and a new server version's defaults go live on its first start. A bootstrap user document that names the built-in default schema is imported against the schema the release stored.

**Breaking:** the platform project no longer admits every origin. Signing in to the console from an address other than `server.public_base`'s, or a loopback one, is refused at the first step; reach the console at `server.public_base`, or set it to the address you use.
