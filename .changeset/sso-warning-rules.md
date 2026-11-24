---
"@zitadel/cli": minor
---

`deploy`, `preview` and `doctor` now warn about eight SSO setups that are valid but cannot work as intended: a connection no schema lists, a schema listing a provider no flow offers, a mapping or verification key no schema defines on a connection nobody lists, a mapping target only some schemas define, verified claims that match nothing the pinned schema defines, a register step offering a provider that never creates users, and automatic user creation that can never fill a required property or verify a required unique one. The warnings do not stop a deploy.
