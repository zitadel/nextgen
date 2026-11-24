---
title: Run the CLI and the local server on Windows
summary: zitadel start now starts the local server on Windows, zitadel setup works beside a running server there, and zitadel doctor no longer reports a file mode Windows cannot hold.
date: 2026-11-24T02:09Z
pulls: [3188]
---

The local server now starts on Windows. It did not before, because the path to its database was not valid on a drive.

- `zitadel setup` scaffolds beside a running local server instead of renaming its `.zitadel` folder, which Windows refuses while the server holds files open.
- `zitadel doctor` checks that `.zitadel/secret` is as private as the filesystem allows, and no longer reports a file mode Windows cannot hold.

[Quickstart](https://preview.zitadel.com/docs/get-started/quickstart)
