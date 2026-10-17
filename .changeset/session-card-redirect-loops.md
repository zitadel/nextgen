---
"@zitadel/components": patch
---

`<zitadel-session>` no longer reloads forever when its `post-sign-out-url` is its own page, written with or without a trailing slash (`/account` on `/account/`, or the reverse) or with its query parameters in another order. It also no longer repeats a no-session navigation to the same target from the same page within ten seconds, so a target that redirects back to the card's page (for example `post-sign-out-url="/"` where `/` sends the visitor to `/account`) ends with the card rendering nothing instead of a redirect loop. A `200` from `/sessions/me` with an empty `session_id` is now an error the widgets show, not a signed-out visitor, matching the server SDKs.
