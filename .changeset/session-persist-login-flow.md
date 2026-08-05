---
"@zitadel/server": minor
---

The login flow now persists a session as soon as it starts: an anonymous
`building` session is created (or the client-supplied one reused), and its
auth-attempt links to it so exchange upgrades that same session in place to
`active` instead of creating a second one. An abandoned `building` shell past
its TTL now reports `expired`.
