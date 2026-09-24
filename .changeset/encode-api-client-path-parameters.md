---
"@zitadel/api": patch
"@zitadel/cli": patch
"@zitadel/server": patch
---

Encode path parameters in the generated API client, so any id the API accepts can be fetched. Schema ids are the case that hit today: a schema's id is its `$id`, usually a URL such as `https://nextgen.com/api/schemas/default-human-user.json`. Sent raw, the `//` collapsed on a redirect and the request 404'd, so `zitadel schemas get <id>` failed for every URL id and the console's user list silently dropped its schema columns. `zitadel schemas get` also stops guessing what an id looks like: it used to read anything without `sch_` or `://` as an object type, which sent ids like `urn:example:human` down the wrong path. It now asks the server, and falls back to the object-type lookup only on a 404. Setup reconciliation and `apply`/`plan` schema fetches used to encode the id themselves to work around the same bug; that is gone, so the client encodes exactly once rather than sending `%25` for every delimiter.
