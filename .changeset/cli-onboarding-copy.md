---
"@zitadel/cli": minor
---

The CLI's onboarding output now says what to do next. `zitadel start` ends by telling you to run `zitadel setup` instead of printing a console link, because the console has nothing to show before `setup` creates your project; `zitadel console` still prints a link whenever you want one. `setup` asks which port your app runs on, which registration fields to collect and which sign-in method to offer first, with every choice spelled out, and shows the sign-in configuration it will create before it writes anything. The optional note about Zitadel's agent skills now appears once per machine at the end of an interactive `setup`, no longer names the agents it found, and `NO_SKILLS_PROMPT=1` still turns it off. `auth-method sso enable` says the provider is configured locally and tells you to `deploy` it, then reload the app and test sign-in.

**Breaking:** `zitadel start --json` no longer has `data.console`, and its `next_actions` and `next_commands` no longer mention the console; a script that reads them gets nothing there. Run `zitadel console --json` for `data.sign_in_url`.
