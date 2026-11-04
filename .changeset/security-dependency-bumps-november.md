---
"@zitadel/server": patch
"@zitadel/cli": patch
"@zitadel/api": patch
"@zitadel/config": patch
---

Update dependencies that have published security advisories. `@zitadel/cli` now
requires `undici` 7.30.1 or later, which fixes TLS certificate validation being
skipped, cache poisoning across redirects and several denial-of-service bugs.
`@zitadel/cli`, `@zitadel/api` and `@zitadel/config` require `zod` 4.6.6 or
later, which stops oversized collections from exhausting memory during
validation. The console embedded in the server picks up the `seroval` and `zod`
fixes.
