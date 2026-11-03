---
"@zitadel/server": minor
---

In the console, the Users list's revision filter picks one schema revision; its `Latest only` and `Older revisions` choices are gone. To find the users still on an older revision, query `POST /users/query` with `schema_object_type` `equals` the schema's object type and `schema` `not_equals` its newest revision. The revision menu there and on a schema's detail page shows each revision the same way: a shortened id, its creation time, and `Latest` and `In use` badges. An older revision no longer carries a note and migration-guide link under Field definitions; its badges say where it stands.
