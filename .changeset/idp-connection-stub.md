---
"@zitadel/server": minor
---

The identity provider connection endpoints answer instead of reporting themselves unimplemented: `POST /idps` creates a connection or revises the one holding that slug, `POST /idps/query` lists them, and `GET /idps/{id}` returns one. This is a placeholder so the CLI's connection syncer can be built and run against a local server: connections are held in the server process's memory, so they do not survive a restart and are not shared between replicas, and schema validation, the immutable-field rules and revision history arrive with the real service.
