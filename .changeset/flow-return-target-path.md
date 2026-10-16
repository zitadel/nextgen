---
"@zitadel/server": patch
---

An SSO flow submit checks its `return_target` as a browser reads it, and refuses with `400 req.invalid` any target that a browser or a proxy could take to be another place than the one it names. Besides the existing origin check, it must be a printable-ASCII http or https URL without userinfo or a backslash in its authority or path, and its path, once dot segments are resolved (also when written `%2e`) and once percent-decoded, must not start with `//`. A path starting that way is on the request origin, but a proxy that re-bases the callback's redirect onto its own host would read it as another host and send the browser there after sign-in.
