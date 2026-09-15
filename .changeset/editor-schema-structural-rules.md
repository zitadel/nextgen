---
"@zitadel/api": minor
"@zitadel/cli": minor
"@zitadel/config": minor
---

The branding and flow definition editor schemas now flag what the server rejects: asset URLs that carry `user:password@`, `typography.font_url` without `typography.font_family`, a terminal step that also collects or acts, a step that does nothing, `sso_providers` without a `callback` transition, and a transition that sets both `purpose` and `action`. The API client's Zod schemas reject credentials in branding asset URLs, and `zitadel plan` measures asset URL length in bytes, as the server does.
