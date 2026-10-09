---
"@zitadel/config": patch
"@zitadel/cli": patch
"@zitadel/components": patch
---

`zitadel setup` now asks "How should users sign in?" and scaffolds the
matching schema+flow preset: `password-first` (today's default) or
`passkey-first` (a one-tap passkey on the login entry step with an
email → password fallback path, passkey-primary registration, and email
kept required so the fallback always works). Non-interactive and scripted
runs use `--preset`; the choice is recorded in `zitadel.json`. Presets are
named bundles under `@zitadel/config` (the mechanism behind app-type
selection, #448) and are hygiene-tested: every bundle must pass the flow
validator and resolve every text key in every builtin locale.
