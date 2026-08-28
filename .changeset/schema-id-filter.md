---
"@zitadel/server": minor
---

`GET /schemas` accepts a repeatable `id` query parameter, so a caller holding a set of schema ids can resolve them in one request instead of one request per id. Ids are revision-specific, so superseded revisions resolve too; an id that matches nothing (including one from another project) is absent from the result rather than an error, and at most 100 ids are accepted per request.
