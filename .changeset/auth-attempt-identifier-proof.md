---
"@zitadel/server": patch
"@zitadel/api": patch
---

An identifier proof now says which attribute its value belongs to, so a client can authenticate without a rendered login step. `POST /auth_attempts/{id}/challenges/{id}/verify` takes `attribute_name` alongside `login_name`: a project decides for itself whether users are identified by `email`, `username` or something else, and the login flow reads that from the step it rendered — a client that renders nothing had no way to say it, so the proof resolved no user and the whole auth-attempt API could not sign anyone in. The factor payloads in an attempt response now also declare the `method` they are discriminated on, which the server always sent but the schema forbade, so a generated client can decode a completed password factor.
