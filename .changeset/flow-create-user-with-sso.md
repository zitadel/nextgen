---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/config": minor
---

A flow step's `on_success` accepts `create_user_with_sso` alongside `create_user`, and the engine runs it: a step declaring it creates the user from the identifier the external provider verified, recording the user factor without a password, and the flow it completes mints a handoff token as any other completion does. No shipped flow declares it yet, so nothing reaches it until a provider can be enabled.

The provider identity link is not stored yet, so a returning external identity is treated as a new one and re-enters registration rather than signing in. When its address already belongs to an account, the flow routes to its conflict step to verify ownership. Linking `(connection, subject)` to a user lands separately.
