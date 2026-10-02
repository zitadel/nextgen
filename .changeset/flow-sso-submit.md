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
`client_id` is filled from the project's variables. The response re-seals
`_zflow` and adds the browser-binding cookie the callback checks. On every
host except http loopback it is `__Host-_zsso` with `Secure`. When the
request host is http loopback (local development, where Safari rejects
`Secure`), it is `_zsso` with no `Secure`; the `__Host-` prefix is dropped
because it requires `Secure`. In both cases the cookie is `HttpOnly`,
`Path=/` and `SameSite=Lax`.

The flow responses' `Set-Cookie` header is now declared as a list, one
header line per cookie, `_zflow` first. Browsers never expose the header to
script; the shape concerns server-side and generated non-browser clients.

The submit request gains `return_target`, the page hosting the
orchestrator where the flow resumes after the callback. It is required with
action `sso`, and its origin must equal the request origin. A provider the
engine cannot start a sign-in with re-renders the step with
`error.sso_unavailable`, which the orchestrator localizes. The orchestrator
sends its page URL, with the flow id set in the `flow` query parameter, as
`return_target` on an sso submission.

When the orchestrator resumes a flow handle, from the `flow` query
parameter or from `resume-flow-id`, and the flow no longer resolves, it
starts a new flow instead of showing a startup error, with a console
warning naming the handle. This covers the return from an external sign-in
after the flow cookie's window: the browser no longer sends the required
cookie and the server refuses the request with 400.
