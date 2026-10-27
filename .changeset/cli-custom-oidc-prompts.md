---
"@zitadel/cli": minor
---

`zitadel auth-method sso enable --provider custom` now asks at a terminal for the connection's name, its sign-in button's name, the issuer URL and the scopes you leave out, instead of failing with a list of flags; scripts still need the flags ([docs](https://preview.zitadel.com/docs/reference/cli/auth-method/sso/enable)). A new custom connection also prints its claim mappings and the file to edit them in.
