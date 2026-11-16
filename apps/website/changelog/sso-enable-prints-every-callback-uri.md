---
title: auth-method sso enable prints the callback URI for every origin
summary: zitadel auth-method sso enable now prints the callback URI to register for each deployed origin, so sign-in works on the deployed app, and describes what the connection maps.
date: 2026-11-11T17:33Z
pulls: [2176, 2919, 2920, 2979]
---

`zitadel auth-method sso enable` now prints the callback URI to register with the provider for each deployed origin of the project, and a note for each preview origin pattern, since providers take no wildcards. Before, it printed only the local development callback URI, so sign-in failed on the deployed app and its previews.

It also describes the connection in a few lines, and `--dry-run` and `zitadel setup` show the same:

- which claim fills each user attribute, and what verifies it;
- the scopes the connection requests;
- the attributes no claim fills yet, required or optional;
- the user schemas that sign in through it.

With `--json`, `sso enable` reports these in `data.connection` and `setup` in `data.sso[]`. `setup` also asks for the sign-in button's name first and suggests the connection's slug from it, and asks before it continues with no provider ticked.

[Social sign-in](https://preview.zitadel.com/docs/guides/social-sign-in)
