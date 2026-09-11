---
"@zitadel/api": minor
---

The identity provider connection endpoints are now part of the API contract, and the generated clients carry them.

`POST /idps` publishes a connection document. The `slug` in the document decides what happens: a slug the project has not used creates a connection, and a slug it already has appends a revision to that connection. `POST /idps/query` pages through a project's connections. `GET /idps/{id}` and `GET /idps/slug/{slug}` each read one connection with the revision it currently serves.

The request and response bodies mirror the `idp-connection.json` meta-schema, so a connection is typed the same way in a client as it is in a `.zitadel/idps/<slug>.json` file.

Handlers are not implemented yet, so the endpoints answer not implemented.
