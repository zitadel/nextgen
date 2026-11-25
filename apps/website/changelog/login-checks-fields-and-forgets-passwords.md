---
title: The login checks fields before it submits, and forgets passwords between steps
summary: <zitadel-login> checks a field's length before submitting, shows a wrong password on the password field, no longer carries a typed password to the next step, and names the attribute that keeps it from starting.
date: 2026-11-06T23:31Z
pulls: [2677, 2681, 2676]
---

`<zitadel-login>` now checks a field's minimum and maximum length before it submits, and shows the error on the field it concerns.

- A wrong password (`error.invalid_credentials`) shows on the password field instead of in the form-level alert.
- `<zl-field>` shows only the error under a field while it has one, and its help text again once the error clears.
- A typed password or one-time code is no longer carried to the next step: after "Use another account", or on any later step that asks for one, the field starts empty. A value the same step refuses is kept so it can be corrected.
- When it cannot start a flow, it says which attribute is wrong: a `purpose` that is not a flow purpose (listing the valid ones), a `flow-name` that is not a valid name, a project id the server refuses or does not have, or a purpose no active flow serves.

A custom template must render the password field's error (`f.name | fieldError: errors`) to show a wrong password.

[Customize the design](https://preview.zitadel.com/docs/guides/customize-design)
