---
title: The login says why it switched to sign-up
summary: When an email has no account, the login component turns into a sign-up and says so, with a note to fix a typo in the email. An email that has an account turns it into a sign-in.
date: 2026-10-27T23:26Z
pulls: [2373]
---

`<zitadel-login>` now says why it switched between sign-in and sign-up by itself. An email without an account becomes a sign-up, with a note to fix a typo in the email field, and one with an account a sign-in. A sign-in with an identity provider that has no account yet gets the same note. Flow API steps carry `purpose` and, after a switch, `notice`.

## Upgrading a page or design from an earlier release

- A page that shows its own heading in place of the widget's should follow `step.purpose` from the `zitadel-flow-step` event, not step names. The `AGENTS.md` section `zitadel setup` writes now says so too.
- A design ejected earlier shows the notice once its template renders `messages`, as the designs `zitadel branding eject` copies now do.

[The login component](https://preview.zitadel.com/docs/sdks/components)
