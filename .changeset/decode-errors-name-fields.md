---
"@zitadel/server": minor
---

Request decode errors keep the normalized `req.invalid` message and now
carry `details.fields`: the dotted paths of the fields the request
validation rejected, names only, never values or decoder text. For map
fields the last path element is the client's own key.
