---
"@zitadel/config": patch
"@zitadel/cli": patch
---

`zitadel setup` now asks "Who will sign in to your app?" and scaffolds the
matching schema fields: `minimal` (email only, today's default), `consumer`
(email, given and family name), or `business` (adds a `companyName` attribute).
This is a second axis alongside the sign-in preset (#448): the use case owns
the schema field set, the sign-in preset owns the flow, and the login flow's
register step is derived from the chosen fields instead of a hard-coded list —
so the two compose instead of multiplying into a bundle per pair. The
question is asked before the sign-in preset; non-interactive and scripted
runs use `--use-case` (defaults to `minimal`, never blocks); the choice is
recorded in `zitadel.json` for guidance/status only, never behavior. `business`
is a field set only for now — `companyName` is a plain user attribute with no
org/team model behind it yet — and the scaffolded `AGENTS.md` says so. Every
(use case × sign-in preset) pair is hygiene-tested against the flow validator.
The unused, divergent `buildUserSchema`/`fieldPreset` helpers are removed in
favor of a single source of field defaults.
