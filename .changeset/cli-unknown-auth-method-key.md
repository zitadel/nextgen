---
"@zitadel/cli": patch
"@zitadel/config": patch
---

`zitadel deploy --dry-run` and `zitadel doctor` now refuse a user schema whose `x-auth-methods` holds a key that is not an authentication method, such as a misspelt `pasword`, and suggest the method it was likely meant to be. An unknown key inside a method and an empty `x-auth-methods` are refused too. Before, the dry run passed and the deploy failed with a generic request error.
