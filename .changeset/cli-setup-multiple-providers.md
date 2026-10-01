---
"@zitadel/cli": minor
---

`zitadel setup` no longer limits onboarding to one social provider. The onboarding question is a multi-select rather than one choice, and declining is an empty selection rather than a "not now" option beside the providers. Each chosen provider is asked for its own client id and secret, gets its own connection file, and has its slug added to the schema and the login flow — which already carried `sso_providers` as a list. The summary and the `--json` payload report one entry per provider, so a publish that did not land names the provider it belongs to. `--sso` still takes a single provider: a scripted run pipes one secret on stdin, and `sso enable` adds the rest. The catalog ships one provider today, so this changes what the CLI supports rather than what a developer can pick right now — a second catalog entry is what makes the multi-select visible.
