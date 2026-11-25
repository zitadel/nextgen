---
title: The login shows the minimum password length up front
summary: <zitadel-login> shows the project's minimum password length under the password field while someone chooses a password, not only after a submit that was too short.
date: 2026-10-29T07:54Z
pulls: [2417]
---

`<zitadel-login>` now shows the project's minimum password length under the password field while someone chooses a password, instead of only after a too-short submit. The designs `zitadel branding eject` copies show it too; a template you ejected earlier gets it when you add `| fieldRuleHint: f` to its `field_help` line.

A field's clear button no longer appears while the field is empty.

[Customize the design](https://preview.zitadel.com/docs/guides/customize-design)
