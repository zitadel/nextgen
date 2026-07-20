---
"@zitadel/config": patch
"@zitadel/cli": patch
"@zitadel/server": patch
---

`zitadel setup` now asks "Who will sign in to your app?" and scaffolds the
matching schema fields: `minimal` (email only), `consumer` (email, given and
family name), or `business` (adds a `companyName` attribute). `minimal` is the
default, so the no-flag scaffold now collects **email only** — a deliberate
slim-down from today's output: given/family name move to `consumer`/`business`,
and `dateOfBirth` is no longer scaffolded by any use case. The default schema
and login-flow templates (embedded as the server-side fallback for projects
created without the CLI) are slimmed to the same email-only baseline, so the
no-CLI default and the `minimal` use case now agree; the per-field bodies for
`givenName`/`familyName`/`companyName` move into the config field catalog the
CLI composes from. This is a second axis alongside the sign-in
preset (#448): the use case owns
the schema field set, the sign-in preset owns the flow, and the login flow's
register step is derived from the chosen fields instead of a hard-coded list —
so the two compose instead of multiplying into a bundle per pair. The
question is asked before the sign-in preset; non-interactive and scripted
runs use `--use-case` (defaults to `minimal`, never blocks); the choice is
recorded in `zitadel.json` for guidance/status only, never behavior. `business`
is a field set only for now — `companyName` is a plain user attribute with no
org/team model behind it yet. Every (use case × sign-in preset) pair is
hygiene-tested against the flow validator.
The unused, divergent `buildUserSchema`/`fieldPreset` helpers are removed in
favor of a single source of field defaults.
