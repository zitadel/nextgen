---
title: User attributes must match their schema's format
summary: Creating a user, updating one and signing up now refuse a value that does not match its property's format, such as not-an-email for an email property. This is a breaking change.
date: 2026-11-09T08:03Z
cloud: true
pulls: [2687]
---

Creating a user, updating one and signing up now refuse a value that does not match its property's `format`, such as `not-an-email` for `format: email`, with `attributes_invalid` naming the attribute. This covers JSON Schema's standard formats, such as `email`, `uri`, `uuid`, `date` and `date-time`. Any other format, such as `phone`, stays a label.

- `zitadel users create` and `zitadel users update` refuse the same values.
- In a login flow, a blank optional field with a format counts as unset, and a `date-time` field gets a date and time input.

**Breaking:** values stored before this change get no exception. A patch to a user holding a value that fails its `format` is refused until the same request corrects it, and a stored identifier that fails its `format` no longer signs in or starts recovery. Correct such values with `PATCH /users/{id}` or `zitadel users update`. On a self-hosted server, a `--user-file` that creates a user with a bad value stops the server from starting.

[The users API](https://preview.zitadel.com/docs/reference/api/users)
