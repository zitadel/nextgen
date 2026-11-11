---
title: "Security: signing in needs a verified password, passkey or SSO"
summary: An auth attempt could issue a session after verifying only the user's identifier. It now needs a verified password, passkey or SSO factor, and step-up sign-in needs the session's token.
date: 2026-10-21T17:58Z
cloud: true
pulls: [2211, 2166]
---

A sign-in through `POST /auth_attempts` could issue a session after verifying only the user's identifier, with no password, passkey or SSO. The project's publishable key, which is public by design, can call these endpoints, so anyone holding it could sign in as any user whose identifier they knew.

An attempt now completes only once it carries a verified password, passkey or SSO factor, and `POST /auth_attempts/{id}/handoff` refuses one without it with `att.not_completed`. A client that drives the auth-attempt API directly must verify one of those factors before it asks for a handoff.

Sessions issued through this gap stay valid until they expire: list your active sessions and revoke any whose only factor is `identifier`.

Step-up sign-in now also needs proof that the caller holds the session. A request to `POST /auth_attempts` or `POST /flow` that names an existing `session_id` must send that session's `session_token` too, as `POST /sessions` or `POST /sessions/exchange` returned it; without it, the request is refused with `400`.

[Sessions and auth attempts](https://preview.zitadel.com/docs/concepts/sessions-auth-attempts)
