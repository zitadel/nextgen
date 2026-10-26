---
"@zitadel/server": minor
---

`GET /flow/{id}` and `POST /flow/{id}/submit` refuse with `409` `rel.revoked` when the release sealed into `_zflow` at create time was revoked since the attempt started. Step configuration continues to come from the sealed `DefinitionID` in the cookie; a mid-attempt deploy does not retarget an in-flight sign-in.
