---
"@zitadel/server": minor
---

The flow engine now persists a session as soon as a flow starts: an anonymous
`building` session is created (or the client-supplied one reused), and its
auth-attempt links to it so exchange upgrades that same session in place to
`active` instead of creating a second one. An abandoned `building` shell past
its TTL now reports `expired`.
