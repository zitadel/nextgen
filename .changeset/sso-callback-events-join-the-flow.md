---
"@zitadel/server": patch
---

An SSO sign-in's callback events (`auth.sso.*` and the callback's `request.api`) now carry the login flow's `flow_id`, so `GET /events?flow_id=…` returns the provider's answer with the rest of the sign-in.
