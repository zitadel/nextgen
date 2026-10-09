---
"@zitadel/server": patch
"@zitadel/components": patch
---

Fix the duplicate "Continue with passkey" button: flow responses no longer embed a stale copy of the default login template. The login widget renders the up-to-date template bundled with `@zitadel/components`, which also brings checkbox/select field rendering and the empty-subtitle guard to real flows. A tenant-provided `branding.liquid_template` still takes precedence.
