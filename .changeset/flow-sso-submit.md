---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/components": patch
---

An sso submission starts the external sign-in. `{action: "sso",
sso_provider_id, return_target}` on a step that offers `sso_providers`
pins the connection at its newest revision, issues the single-use state
record on the auth attempt and returns the `sso-redirect` step, whose
`redirect_url` is the provider's authorize URL with `state`, `nonce` and,
when the connection enables PKCE, an S256 code challenge. A `${{ NAME }}`
`client_id` is filled from the project's variables. The response's
`Set-Cookie` carries the browser-binding cookie the callback checks:
`__Host-_zsso` with `Secure` on https, `_zsso` without on an http
development host, `HttpOnly`, `Path=/`, `SameSite=Lax`. The flow state does
not change, so `_zflow` is not rotated on that response.

The submit request gains `return_target`, the page hosting the
orchestrator where the flow resumes after the callback. It is required with
action `sso`, and its origin must equal the request origin. A provider the
engine cannot start a sign-in with re-renders the step with
`error.sso_unavailable`, which the orchestrator localizes. The orchestrator
sends its page URL as `return_target` on an sso submission.
