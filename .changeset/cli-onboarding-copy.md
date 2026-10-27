---
"@zitadel/cli": minor
---

The CLI's onboarding output now says what to do next: `zitadel start` points to `zitadel setup` instead of a console link, `setup` spells out every choice and shows the sign-in configuration before writing it, and `auth-method sso enable` says to `deploy` the provider, then test sign-in. The note about Zitadel's agent skills shows once per machine.

**Breaking:** `zitadel start --json` no longer has `data.console`, and its `next_actions` and `next_commands` no longer mention the console; a script that reads them gets nothing there. Run `zitadel console --json` for `data.sign_in_url`.
