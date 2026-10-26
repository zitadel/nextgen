---
"@zitadel/cli": patch
---

The CLI's onboarding output now says what to do next. `zitadel start` ends by telling you to run `zitadel setup` instead of printing a console link (`zitadel console` still prints one, and `start --json` still reports it). `setup` asks which port your app runs on, which registration fields to collect and which sign-in method to offer first, with every choice spelled out, and shows the sign-in configuration it will create before it writes anything. The optional note about Zitadel's agent skills now appears once per machine at the end of an interactive `setup`, no longer names the agents it found, and `NO_SKILLS_PROMPT=1` still turns it off. `auth-method sso enable` says the provider is configured locally and tells you to `deploy` it, then reload the app and test sign-in.
