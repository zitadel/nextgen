---
title: A session cookie no other site can plant, and security headers on every page
summary: "The session cookie is now __Host-zitadel_session, which a browser accepts only from Zitadel's own host over https, and the server sends security headers with every page. Every browser signs in again: update the server, the SDKs, the CLI and @zitadel/testing together."
date: 2026-10-30T02:28Z
cloud: true
pulls: [2488, 2480]
---

The session cookie is now `__Host-zitadel_session`. A browser accepts a cookie with that prefix only from Zitadel's own host over https, so another site under the same domain can no longer plant a session. On `http://localhost` it is `zitadel_session`, so sign-in keeps working in Safari. An app's own session cookie, behind a server SDK or dev proxy, adds `_<project id>`.

The server also hardens every page it serves:

- Other sites can no longer frame its pages, MIME sniffing is blocked, and referrers are limited.
- Camera, microphone and geolocation are turned off, while passkeys and the clipboard keep working.
- The console restricts its scripts with a Content-Security-Policy and logs violations through `/csp-report`.
- The hosted website and docs enforce their script hashes, their 404 pages included.

**Breaking:** every browser signs in again: cookies named `__nextgen_session` are no longer read. Update the server, the server SDKs, the CLI and `@zitadel/testing` together; an SDK from before 0.4.0 keeps no session with a server from 0.4.0, nor the other way round. preview.zitadel.com has used the new names since 30 October, so update your app's `@zitadel/*` packages to 0.4.0. In a single-page app set up before 0.4.0, `zitadel doctor` fails on the dev proxy until `zitadel doctor --fix` updates it. In `@zitadel/testing`, `SESSION_COOKIE_NAME` is `__Host-zitadel_session`, and `sessionCookieName(projectId, url)` and the new `browserSessionCookieName(url)` name the cookies for the app's URL.

[One session cookie per project](https://preview.zitadel.com/docs/sdks/proxy#one-session-cookie-per-project)
