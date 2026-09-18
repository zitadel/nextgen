---
"@zitadel/server": major
"@zitadel/api": major
---

An identifier proof now says which attribute its value belongs to, so a client can authenticate without a rendered login step. `POST /auth_attempts/{id}/challenges/{id}/verify` takes a required `attribute_name` alongside `login_name`: a project decides for itself whether users are identified by `email`, `username` or something else, and the login flow reads that from the step it rendered — a client that renders nothing had no way to say it, so the proof resolved no user and the whole auth-attempt API could not sign anyone in. The factor payloads in an attempt response now also declare the `method` they are discriminated on, which the server always sent but the schema forbade, so a generated client can decode a completed password factor.

Both are breaking schema changes: a request built against the previous schema omits `attribute_name`, and a response decoder generated from it rejects a payload's `method`. Neither could have had a working consumer — the identifier proof resolved nobody, and a completed password factor failed to decode — but a client generated from the old spec still needs regenerating.
