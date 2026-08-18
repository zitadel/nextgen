---
"@zitadel/server": patch
---

The hosted sign-in shell at `/ui/login/` now tells a deployment it cannot reach
apart from one that has no project yet. Its boot-time configuration read
(`GET /console/runtime.json`) used to resolve every failure — a dropped
connection, a `500`, an unreadable body — to the same "No project yet" screen,
so a server whose database was down still served the sign-in page and then told
the people trying to sign in to run `npx @zitadel/cli setup`. Those cases now
render a "Sign-in is unavailable" screen with a retry button that re-reads the
configuration in place, and name the underlying failure in a secondary line for
whoever can act on it. A deployment that answers normally but has no project
still shows the setup hint, unchanged.
