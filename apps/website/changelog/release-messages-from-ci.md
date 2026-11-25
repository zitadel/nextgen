---
title: Releases made in CI get a message, and the CLI shows what each pins
summary: zitadel deploy and zitadel preview record a message without -m, from the pull request's title or the commit, and release get shows the resources a release pins.
date: 2026-11-01T21:16Z
pulls: [2464, 2439]
---

`zitadel deploy` and `zitadel preview` now record a message when `-m` is left out: the title of the pull request on a GitHub pull request build, Vercel's commit message on a Vercel build, and otherwise the subject of the current commit when there are no uncommitted changes. A CI run no longer needs `-m`; with none of these, a non-interactive `deploy` still fails without it.

- `zitadel preview -m` and `zitadel deployment rollback -m` record a message of their own, and a blank or over-long `-m` is refused.
- `zitadel release list` shows when each release was created, `release get` the resources a release pins, and `deployment get` the variables the deployment froze.

[Messages in the deploy guide](https://preview.zitadel.com/docs/guides/deploy#messages)
