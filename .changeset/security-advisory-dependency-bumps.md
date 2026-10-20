---
"@zitadel/server": patch
"@zitadel/cli": patch
"@zitadel/components": patch
"@zitadel/api": patch
---

Update dependencies that have published security advisories. The server picks
up the HTTP/2 and gRPC denial-of-service fixes, the OpenTelemetry exporter fixes
(the log exporter's TLS settings, endpoint URLs in logs) and the
`golang.org/x/crypto` SSH fixes. `@zitadel/cli` now requires `undici` 7.29.1 or
later and `@zitadel/components` DOMPurify 3.4.16 or later, and the optional
`@faker-js/faker` peer of `@zitadel/api` moves to `^10.5.0`.
