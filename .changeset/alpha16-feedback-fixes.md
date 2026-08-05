---
"@zitadel/components": patch
"@zitadel/config": patch
"@zitadel/cli": patch
"@zitadel/server": patch
---

Fixes from alpha.16 community feedback:

- Custom schema fields now render a readable label. A property with no
  catalog entry (e.g. `department`, `dateOfBirth`) falls back to a
  humanised name ("Department", "Date of birth") on the form instead of
  leaking the raw `<step>.field.<name>` text key. A catalogued key still
  wins, so localised labels are unaffected.
- The scaffolded `.zitadel/flows/README.md` no longer contains the
  "Presets" section twice.
- The `warn/default-flow-swap` plan warning now leads with the impact in
  plain language: the new flow becomes the default for its purposes, and
  every page that does not explicitly set `flow-name` on
  `<zitadel-login>` will start rendering it — scope it via `audience`
  or pin `flow-name` to opt out.
- The flip-table validation error (login/register entry step missing its
  `user_not_found`/`user_already_exists` transition) now explains who
  gets stuck where: someone without an account would be stuck at
  sign-in instead of being routed to registration, and vice versa. Plan,
  apply, and the server report the same wording.
