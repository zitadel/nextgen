---
"@zitadel/server": minor
---

`POST /releases` refuses a release that references a flow definition without the user schema its `user_schema` names, with `400 rel.unresolved_reference` naming the pointer and the handle.
