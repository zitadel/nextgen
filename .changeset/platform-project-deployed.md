---
"@zitadel/server": minor
---

With platform bootstrap on, every start deploys the platform project's configuration as a release, the way `zitadel deploy` deploys any project: the platform user schema and the default login flows, to `server.public_base`'s origin, which the platform project now lists as a primary origin. Console sign-in is served that release instead of the newest stored resources, and a new server version's default login flows go live on its first start.

**Breaking:** the platform project no longer admits every origin. Signing in to the console from an address other than `server.public_base`'s, or a loopback one, is refused at the first step; reach the console at `server.public_base`, or set it to the address you use.
