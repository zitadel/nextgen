---
"@zitadel/server": patch
---

Accepting or declining a project invitation as someone who already has a role on the project now answers `409 inv.already_member` with that role and leaves the invitation pending for the person it was meant for, and `lookupInvitation` returns the role as `membership` before either is called.
