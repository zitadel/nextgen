---
---

Render the identity providers a login step offers. A step's `sso_providers` names connections by slug; the engine carries those slugs onto the rendered step and the API resolves each to the display name and brand template the connection owns, so the login page can draw a button per provider. A slug whose connection has been removed is dropped rather than shown, because a button that cannot start a sign-in is worse than no button, and a lookup failure drops them all rather than failing the step.
