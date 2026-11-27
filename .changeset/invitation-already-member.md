---
"@zitadel/server": patch
---

Accepting or declining a project invitation as someone who already has access to the project, through a grant, a team, the owning team or operating the deployment, now answers `409 inv.already_member` with their role and leaves the invitation pending for the person it was meant for, and `lookupInvitation` returns that role as `membership` before either is called.
