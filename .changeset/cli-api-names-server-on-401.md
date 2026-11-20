---
"@zitadel/cli": patch
---

`zitadel api` says which server it called and which secret it sent when the server answers `401`, and its help shows how to update a user (`zitadel api updateUser <user_id> -F attributes.age=1`). A secret belongs to the project on one server, so the hint points at `ZITADEL_URL`, `ZITADEL_PROJECT_SECRET`, `--env` and `--env-file`.
