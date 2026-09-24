---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/config": minor
---

A flow step's `on_success` accepts `create_user_with_sso` alongside `create_user`, and the engine runs it: a step declaring it creates the user from the identity an external provider returned, recording the user factor without a password, and the flow it completes mints a handoff token as any other completion does. No shipped flow declares it yet, so nothing reaches it until a provider can be enabled.
