---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/config": minor
"@zitadel/cli": minor
"@zitadel/components": minor
---

A login flow now chooses whether `<zitadel-login>` switches between sign-in and sign-up on its own, except on a step offering a provider that creates users, and `{ "purpose": "register" }` alone moves to another purpose. `zitadel deploy --dry-run` warns about a switch left out ([flows and schemas](https://preview.zitadel.com/docs/concepts/flows-and-schemas)).

**Breaking:** a flow definition read back through the API (`GET` and list) leaves out a transition's `target` when the transition only names a `purpose`, and a client generated from an earlier API spec fails to read it because it requires `target`. Upgrade `@zitadel/api`, or regenerate your client from the new spec, before deploying a flow that uses the short form. A transition's `target` may no longer be `""`: leave it out instead.
