---
title: The login shows which account you are signing in to
summary: The password step of <zitadel-login> names the account it signs in to, with a way back to use another one, and the step after a social sign-in to an existing account now carries its email.
date: 2026-10-21T22:08Z
pulls: [2155, 2160]
---

The password step of `<zitadel-login>` now shows the account it signs in to, with a "Use another account" link back to the step where the email was typed. Templates ejected with `zitadel branding eject` before this release keep their markup: eject again to get the account row.

The "You already have an account" step after a sign-in with an identity provider now carries the account's email when the provider verified it, so a password manager offers the matching password. It no longer offers the provider that just led there, and offers "Use a passkey" only to an account that has one.

`<zitadel-login>` also shows a spinner only on the button that was used: following the "Sign up" or "Sign in" link no longer spins "Continue".

[The login component](https://preview.zitadel.com/docs/sdks/components)
