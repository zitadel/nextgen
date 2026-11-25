---
"@zitadel/server": patch
---

Someone who already has a role on a project can no longer accept or decline an invitation to it. Accepting used to add a second grant beside the role they had, or a direct grant beside their owning-team access, which stayed behind when that access was removed. Both calls now answer `409 inv.already_member` with the role they hold, the invitation stays pending for the person it was meant for, and `lookupInvitation` returns that role as `membership` so the accept page can say so before anyone clicks.
