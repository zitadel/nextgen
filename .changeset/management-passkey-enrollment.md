---
"@zitadel/server": minor
---

Passkeys can now be registered through the management API: `POST
/users/{user_id}/passkeys` (scope `user.write`) starts a WebAuthn ceremony and
returns the creation options, and `POST
/users/{user_id}/passkeys/{registration_id}` verifies the attestation and
stores the credential with an optional display name. Combined with `POST
/users` and `PUT /users/{user_id}/password`, backends can provision users with
either credential type without going through the hosted login flow.
