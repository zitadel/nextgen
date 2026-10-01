---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/config": minor
---

A flow step's `on_success` accepts `create_user_with_sso` alongside `create_user`, so a login flow that registers a user from an external identity can be authored, validated and stored. The engine handler is not wired yet: a step that reaches it fails with a flow integrity error naming the mutation rather than creating anything, and no flow can reach it while SSO submissions are refused.
