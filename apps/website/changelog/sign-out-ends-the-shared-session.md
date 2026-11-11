---
title: Signing out ends the session in the shared cookie
summary: Signing out through a server SDK's proxy now also ends a session held in the shared __nextgen_session cookie, which Zitadel kept valid until it expired.
date: 2026-10-27T23:26Z
pulls: [2375]
---

**Security:** signing out through a server SDK's `/__nextgen` proxy now also ends a session still held in the shared `__nextgen_session` cookie. Zitadel kept that session valid until it expired, because that sign-out carried no CSRF token. Update your app's `@zitadel/*` packages to 0.2.0.
