---
"@zitadel/server": patch
---

Fix an authentication bypass: a sign-in through `POST /auth_attempts` could
issue a session after verifying only the user's identifier, with no password,
passkey, or SSO. An attempt created without required checks counted as complete
as soon as the identifier resolved, and the project's publishable key, which is
public by design, can call these endpoints, so anyone holding it could sign in
as any user whose identifier they knew.

An attempt now completes only once it carries a verified password, passkey, or
SSO factor, and `POST /auth_attempts/{id}/handoff` refuses one without it with
`att.not_completed`. A client that drives the auth-attempt API directly must
verify one of those factors before it asks for a handoff. Sessions issued
through this gap before you upgrade stay valid until they expire: list your
active sessions and revoke any whose only factor is `identifier`.
