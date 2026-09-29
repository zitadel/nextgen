---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
---

Let a proxied redirect reach the browser when it lands on the app's own origin. The proxy stripped every `Location` header to keep an internal upstream hostname from leaking, which is right for an API response but drops the one redirect external sign-in depends on: the identity provider returns the browser to `/__nextgen/idp/callback`, and the engine answers `302` back to the page the sign-in started on. That is a top-level navigation with no JavaScript in the loop, so the stripped header left the browser on an empty page. A redirect now survives only when it resolves to the app's own origin, and anything else — an absolute URL naming the upstream server, another origin, a protocol-relative `//host/path`, an unparseable value — is dropped exactly as before, so neither the hostname leak nor an open redirect through the app's own origin is possible. The forwarded value is absolute because Next rejects a relative `Location` returned from middleware. Outbound redirects to a provider are unaffected: they arrive as `step.redirect_url` in a JSON body and the widget navigates, never as a proxied header.
