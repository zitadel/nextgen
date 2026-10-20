---
"@zitadel/components": patch
---

Resume the flow an identity-provider callback returns with. The callback finishes by navigating the browser back to the page the sign-in started on with `?flow=<id>` appended. That is a fresh page load, so nothing of the previous document survives to carry the handle, and a page that ignores the parameter starts a new flow — leaving the user on a blank sign-in screen having just signed in. `<zitadel-login>` now falls back to that parameter when `resume-flow-id` is not set, so a host page needs no code of its own for external sign-in to finish; doing it per framework would mean the same few lines in each scaffolded template, and one that forgot them would fail silently. A handle taken from the URL is not a capability: `GET /flow/{id}` only answers when the sealed flow cookie names that same id, so an id someone else put there resolves to nothing.
