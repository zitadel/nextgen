---
"@zitadel/cli": minor
"@zitadel/config": minor
---

Add social sign-in to the CLI. `zitadel sso enable --provider google` configures an identity provider on an existing Project: it says what to register with the vendor and at which redirect URI, takes the client id and secret, writes `.zitadel/idps/<slug>.json`, enables `sso` on the user schema, and adds the provider button plus the steps and routes a provider round trip needs to every login flow that runs against that schema. The client secret is never a flag — it is prompted for, or read from stdin with `--secret-stdin` — and only its `${{ NAME }}` reference reaches the connection file; the value goes to `.env.local`, and only where git is not tracking it. `zitadel setup` asks the same question during onboarding, so a Project can start with Google rather than adding it afterwards, with `--sso`, `--sso-client-id` and `--sso-secret-stdin` for scripted runs. `plan` and `apply` sync connection files like any other resource; deleting one is not supported yet.
