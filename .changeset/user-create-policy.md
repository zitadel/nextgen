---
"@zitadel/server": minor
"@zitadel/cli": minor
"@zitadel/config": minor
"@zitadel/api": minor
---

`zitadel setup` now writes the sign-up policy, `.zitadel/policies/user.create.json`, beside the password policy. It names the challenge every password or passkey sign-up solves, Zitadel's built-in proof of work, which applies with or without the file. Deploy it like any [policy](https://preview.zitadel.com/docs/guides/deploy#policies); `POST /policies` and `zitadel policies test` take `user.create` too.
