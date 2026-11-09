---
title: Read the API contract a server was built from
summary: Every server now serves the OpenAPI document it was built from at GET /api/v1/openapi.json, with no authentication, for clients and agents.
date: 2026-11-04T17:44Z
cloud: true
pulls: [2689]
---

Every server now serves the OpenAPI document its binary was built from at `GET /api/v1/openapi.json`, with no authentication. A client generator, an API tool or a coding agent can read the exact contract of the server it talks to, a self-hosted one included, rather than the one the docs describe at `/docs/openapi.json`.

[The API reference](https://preview.zitadel.com/docs/reference/api)
