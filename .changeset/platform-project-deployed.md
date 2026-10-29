---
"@zitadel/server": minor
---

With platform bootstrap on, every start lists the console's origin (`server.public_base`'s) as a primary origin of the platform project and deploys the platform project's current configuration, policies and branding included, to its primary origins. Console sign-in is served that release like any project's sign-in; a start that changes nothing deploys nothing.

**Breaking:** the platform project no longer admits every origin. Signing in to the console from an address other than `server.public_base`'s, or a loopback one, is refused at the first step; reach the console at `server.public_base`, or set it to the address you use.
