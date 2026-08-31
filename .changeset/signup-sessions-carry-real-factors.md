---
"@zitadel/server": minor
---

Sessions created by sign-up now record how the user authenticated: registering
with a passkey yields a session with a verified passkey factor, and registering
with a password yields one with a verified password factor. Passkey sign-up
also became atomic — if the chosen identifier is already taken, the flow now
routes to `user_already_exists` (matching the password path) instead of
silently attaching the credential, and no partial user is left behind. The
`pkreg.not_found` error code disappeared from `POST /flow/{id}/submit`; an
expired or unknown registration ceremony now surfaces as `att.stale_challenge`.
