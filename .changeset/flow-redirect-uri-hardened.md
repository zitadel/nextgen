---
"@zitadel/server": patch
---

The `redirect_uri` a caller passes when creating a flow is now parsed with the same hardened check as `return_target` (`httputil.ParseRedirectTarget`), so a target whose path a browser or proxy could read as another host is refused with `400 req.invalid` instead of being stored and later redirected to.
