---
title: The API moves under /api/v1
summary: The server answers its API under /api/v1, and from 0.4.0 the SDKs, the console and the CLI call it there. Upgrade a self-hosted server before the apps that call it.
date: 2026-11-01T03:58Z
cloud: true
pulls: [2358, 2357, 2359]
---

The server now answers its API under one prefix, `/api/v1`, such as `POST /api/v1/projects` and `GET /api/v1/users/me`, so a proxy, firewall or rate limit in front of it can select API traffic by that prefix. The console, the identity provider callbacks and the health probes `/livez` and `/readyz` stay at the root.

From 0.4.0, the SDKs, the login components, the console and the `zitadel` CLI call the API under `/api/v1`.

- `@zitadel/api`'s client puts `/api/v1` after the proxy path or server origin it is given, and keeps a single prefix when the origin already ends in it. It exports the prefix as `API_PREFIX`.
- `zitadel api` takes a path with or without the prefix and shows the full URL with it.
- The server SDKs' `/__nextgen` proxies and the dev proxies `zitadel setup` writes for single-page apps recognize the session calls under `/api/v1` as well as at their old paths.
- A call the server knows no operation for now says the server may be older than the client.

Until 1.0.0, the server also answers every operation at its old path, without the prefix, with a `Deprecation` header and a `Link` to the docs. Move clients that still call those paths to `/api/v1`: 1.0.0 drops them.

**Breaking:** clients from 0.4.0 need a server that serves `/api/v1`, so upgrade a self-hosted server before the apps that call it. In a single-page app set up by an earlier `zitadel setup`, run `zitadel doctor --fix`: the dev proxy it wrote adds the project secret only to the old path of the session exchange, so sign-in fails until it is updated, and `zitadel doctor` now fails on it. A production proxy you wrote for a single-page app must add the project secret to `POST /api/v1/sessions/exchange`.

[The API reference](https://preview.zitadel.com/docs/reference/api), [SPAs in production](https://preview.zitadel.com/docs/sdks/proxy#spas-in-production)
