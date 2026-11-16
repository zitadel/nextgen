---
title: Choose whether the login switches between sign-in and sign-up
summary: A login flow now decides whether <zitadel-login> moves between sign-in and sign-up on its own, and a link to the other purpose needs only its purpose.
date: 2026-11-02T08:22Z
cloud: true
pulls: [2533]
---

A login flow now chooses whether `<zitadel-login>` switches between sign-in and sign-up on its own: an email with no account continuing as a sign-up, and an email that has one continuing a sign-up as a sign-in. A flow that leaves a switch out keeps that email on its step with an error, and its Sign up and Sign in links keep working. To serve only one purpose, list only it in the flow's `purposes`.

- A transition that moves to another purpose needs only that purpose: `"register": { "purpose": "register" }` goes to the entry step of sign-up, with no `target`.
- `zitadel deploy --dry-run` warns about a switch left out and still deploys, except on a step that offers a provider that creates users, where `deploy` requires it.
- Set a switch notice's text to `""` in the login's `locales` to show none.

**Breaking:** a flow definition read back through the API (`GET` and list) leaves out a transition's `target` when the transition only names a `purpose`, and a client generated from an earlier API spec fails to read it, because it requires `target`. Upgrade `@zitadel/api`, or regenerate your client from the new spec, before you deploy a flow that uses the short form. A transition's `target` may no longer be `""`: leave it out instead.

[Link sign-in and sign-up](https://preview.zitadel.com/docs/guides/edit-login-flow#link-sign-in-and-sign-up)
