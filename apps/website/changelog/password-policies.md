---
title: Set a password policy for your project
summary: Publish a password policy with a minimum and maximum length and a history depth, and ship it with a release, which every sign-in and sign-up then applies.
date: 2026-10-26T10:00Z
cloud: true
pulls: [2109, 2228, 2329, 2126]
---

`POST /policies?project_id=…` publishes a password policy as a new revision, with optional `min_length`, `max_length` and `history_depth`. The newest revision applies the next time a password is set; existing passwords are not re-checked. The new scopes are `policy.read` and `policy.write`.

- `GET /policies?project_id=…` lists a project's policies at their newest revision, `GET /policies/{policy_id}` reads one, and `GET /policies/{policy_id}/revisions` pages its history; the reads accept a console session too. A refused publish lists every failed setting or rule in `details.details.violations`.
- `POST /releases/build` takes policies under `policies` and pins each, adding a revision only for a changed one. A sign-in or sign-up applies the policy its release pins, none when it pins none, and the newest revision when no release resolves.
- From the next release of `@zitadel/components`, the login's password field follows the policy's `min_length` and `max_length`, or the 64-character cap, where a user chooses a password, and refuses one outside them with the bound in the message. The fixed minimum of 8 is gone, so a project without a policy has none.

[Policies in the API reference](https://preview.zitadel.com/docs/reference/api/policies/publishPolicy)
