---
"@zitadel/server": patch
"@zitadel/api": patch
---

The auth-attempt API can now identify a user, so a client that renders no login step can sign one in. `POST /auth_attempts/{id}/challenges/{id}/verify` resolved an identifier proof against an attribute with an empty name, which matched nobody, so every proof was rejected. It now resolves the login name against the identifier each user schema designates (`x-identifier`), among that schema's users and uniquely registered values only, and it must identify exactly one user — none, or users of more than one schema, rejects the proof. The request is unchanged; the caller never names the property. The completed-factor payloads in an attempt response now also declare the `method` they are discriminated on, pinned per variant, which the server always sent but the schema forbade.
