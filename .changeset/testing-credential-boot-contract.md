---
"@zitadel/testing": minor
---

Boot-captured credentials are now a documented contract on the instance
handle. `handle.projectSecret` and `handle.previewSecret` are captured the
one time the server mints them at provisioning, and a new `handle.platform`
slot reserves the upcoming platform-plane credentials (platform project id
and publishable key) — fixtures written against it today won't churn when
platform provisioning ships; until then the slot stays unset, and further
platform credentials will join it as optional fields once their design
lands. `AppEnvTemplate` now accepts only the handle's string fields, so
mapping a structured field into an env var fails at compile time instead of
at app boot, and handshake files reject malformed `platform` blocks on read
with the offending field named.
