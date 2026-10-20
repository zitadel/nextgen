---
"@zitadel/server": minor
---

Add the identity provider connection endpoints: `POST /idps` creates a
connection for a new slug (201) or appends a revision to the existing one
(200), with the document validated against `idp-connection.json` before it
is stored and the identity fields (`protocol`, `subject_claim`, OIDC
`issuer`, OAuth2 `token_endpoint` and `userinfo_endpoint`) fixed for the
life of the connection. `GET /idps/{id}`, `POST /idps/query` (filter and
sort by `slug` and `created_at`), `GET /idps/{id}/revisions` and
`GET /idps/revisions/{revision_id}` read them. Writes emit `idp.created`
and `idp.updated` audit events.
