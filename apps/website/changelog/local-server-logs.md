---
title: Find why a local sign-in failed with zitadel logs
summary: zitadel logs shows the local server's warnings in yellow and its errors in red, and --level warn shows only those.
date: 2026-10-27T23:26Z
pulls: [2245]
---

`zitadel logs` now shows the local server's warnings in yellow and its errors in red, and `--level warn` shows only those, so the reason a sign-in failed is easy to find. `zitadel start` and `zitadel doctor` say to keep `zitadel logs --follow` open, and `zitadel logs` works from an app inside the directory `zitadel start` ran in.

[zitadel logs](https://preview.zitadel.com/docs/reference/cli/logs)
