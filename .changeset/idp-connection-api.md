---
"@zitadel/server": minor
"@zitadel/api": minor
---

The identity provider connection endpoints are now part of the API contract, and the generated clients carry them.

`POST /idps` creates or revises a connection document. If the slug does not already exist, a new connection is created. If a connection with that slug already exists, a revision is created. `POST /idps/query` pages through a project's connections. `GET /idps/{id}` reads one connection at its newest revision. `GET /idps/{id}/revisions` lists a connection's revisions newest first. `GET /idps/revisions/{revision_id}` reads one revision.

The request and response bodies mirror the `idp-connection.json` schema, so a connection is typed the same way in a client as it is in a `.zitadel/idps/<slug>.json` file.

No handler ships yet. Until the handlers ship, calling one of these endpoints returns 500 with the `internal` code.
