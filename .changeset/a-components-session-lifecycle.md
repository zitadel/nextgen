---
"@zitadel/components": patch
---

`<zitadel-session>` and `<zitadel-logout>` render nothing after a sign-out that stays on the page
(no `post-sign-out-url`), and fetch the identity again when their `project` changes. An identity
answer that arrives after the sign-out no longer brings the signed-out user back. A
`configureZitadel()` call made after the widgets mounted now starts the waiting sign-in flow and
loads the session identity. The sign-out request now sends a JSON content type, so framework CSRF
guards (such as Qwik Router's) no longer refuse it behind a proxy.
