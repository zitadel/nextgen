---
"@zitadel/config": minor
"@zitadel/server": minor
---

The default login flow gains a `passkey-upsell` step between `register-password` and `done`. A user who has just set a password is offered a passkey (`passkey_register`) with a `skip` action beside it, so registration no longer ends on the password step. The copy already existed in the orchestrator's locales; only the flow definition was missing it. Tenants running an ejected flow definition are unaffected — the step is added to `defaults/default-login.json`, not injected at runtime — and `@zitadel/api-mock` mirrors it.
