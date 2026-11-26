---
"@zitadel/server": minor
"@zitadel/api": minor
---

`POST /flows` and `PUT /users/{user_id}/password` accept an `X-Zitadel-Release` header naming the release an app was built against. A value that is not a release id is refused with `400 rel.reference_invalid`.
