---
"@zitadel/cli": minor
---

`zitadel start` now provisions the platform project in the local runtime, so the console's own sign-in and `zitadel claim` work against a local server the same way they do on Zitadel Cloud. Before, the claim page signed in against the app's own project and stopped on an origin error while the CLI waited out the link. A local runtime started by an older CLI is restarted (its data is kept) the next time you run `zitadel start`, so an upgrade does not leave a server without the platform project running.

`zitadel claim --json` now writes the claim link and its expiry to stderr (stdout stays the single JSON envelope), so an agent driving the command can hand the link to a human instead of blocking silently until it expires.

`zitadel status` and `zitadel doctor` now report a recorded owning team on any server, not only on Zitadel Cloud; only the "attach it to a team" nudge stays cloud-only.
