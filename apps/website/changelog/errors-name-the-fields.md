---
title: Validation errors name the fields to fix
summary: When the API refuses user attributes that fail the schema, it answers 400 req.invalid and names every failing field, and an over-long password is a password policy violation.
date: 2026-10-21T15:05Z
cloud: true
pulls: [1894, 2107]
---

When `POST /users`, `PATCH /users/{user_id}` or `PATCH /users/me` refuses attributes that fail the user schema, the answer is now `400 req.invalid`, the same as for a malformed body, and `details.details.fields` lists every failing field by its path from the request body, such as `attributes.country` or `attributes.address.zip`. A unique value another user holds still answers `409 user.already_exists`, and names the attributes whose value is taken the same way, without naming the user who holds it.

A password longer than 64 characters set through the API is now refused with `user.password_policy_violation`, with `{"violations": {"max_length": 64}}` in `details.details`. During sign-up, the same refusal is an error on the step with the password field, so the user can choose another password.

**Upgrading:** clients that matched `user.invalid` for schema failures should match `req.invalid`, and clients that matched `user.password_too_long` for over-long passwords should also handle `user.password_policy_violation`.

[Users in the API reference](https://preview.zitadel.com/docs/reference/api/users)
