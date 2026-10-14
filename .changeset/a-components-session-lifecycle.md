---
"@zitadel/components": patch
---

`<zitadel-session>` and `<zitadel-logout>` drop the signed-in identity after a sign-out that stays
on the page (no `post-sign-out-url`), and fetch the identity again when their `project` changes. A
`configureZitadel()` call made after the widgets mounted now starts the waiting sign-in flow and
loads the session identity. The sign-out request now sends a JSON content type, so framework CSRF
guards (such as Qwik Router's) no longer refuse it behind a proxy.
