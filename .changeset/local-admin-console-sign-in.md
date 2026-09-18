---
"@zitadel/cli": minor
"@zitadel/server": patch
---

`zitadel start` now boots the local server with the platform project and a local admin, so you exist on your own server without signing up, and prints a one-time link that signs you in to the console. The new `zitadel console` command mints a fresh link whenever you need one; the console honours such a link only when it is served from loopback. A local `zitadel setup` attaches the new project to the admin's team, so `zitadel claim` reports it as already owned. A harness that wants a bare single-project instance sets `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT=false` and gets neither the platform project nor the admin. Users imported with `--user-file` now register unique attributes from their user schema's `x-unique` annotations, so a user whose schema identifies users by email can sign in.
