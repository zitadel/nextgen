---
"@zitadel/cli": minor
---

`zitadel auth-method sso enable --provider custom` now asks for the connection's name, the name on the sign-in button, the issuer URL and the scopes when you run it in a terminal and leave them out, instead of stopping with an error that lists the flags. Scripts and `--non-interactive` runs still need the flags and still get that error. When it writes a new custom connection it also lists the claim mappings, says which side of each line is your user attribute and which is the claim the provider must return, and names the file to edit them in. The `--provider` help now says that `custom` means a custom OpenID Connect (OIDC) provider.
