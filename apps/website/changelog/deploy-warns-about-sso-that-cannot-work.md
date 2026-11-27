---
title: zitadel deploy warns about SSO setups that cannot work
summary: deploy, preview and doctor warn about eight SSO setups that are valid but cannot work as intended, such as a connection no schema lists or a register step offering a provider that never creates users. The warnings do not stop a deploy.
date: 2026-11-24T22:23Z
pulls: [3287]
---

`zitadel deploy`, `zitadel preview` and `zitadel doctor` now warn about SSO setups that pass validation but cannot work as intended. Each names the mistake once, at its cause, and none stops a deploy. They warn about:

- a connection that no user schema lists;
- a schema that lists a provider no flow offers;
- a mapping or verification key that no schema defines, on a connection nobody lists;
- a mapping target that only some schemas define;
- verified claims that match nothing the pinned schema defines;
- a register step that offers a provider that never creates users;
- automatic user creation that can never fill a required property, or never verify a required unique one.

[Add social sign-in](https://preview.zitadel.com/docs/guides/social-sign-in)
