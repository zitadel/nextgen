---
title: Move a project to the latest release with zitadel upgrade
summary: The new zitadel upgrade moves a project's pinned @zitadel/* packages to the latest release and shows the breaking changes on the way, and zitadel doctor groups its checks and says when a newer CLI exists.
date: 2026-11-06T23:31Z
pulls: [2601, 2761]
---

`zitadel upgrade` moves the project's exactly pinned `@zitadel/*` packages to the latest release with the project's package manager. It shows the breaking changes of every release on the way before it installs, then refreshes the generated files. `--dry-run` changes nothing, and a version range or a dist-tag is reported and left alone.

`zitadel doctor` and `zitadel --version` now say when a newer CLI exists: `--version` in a box with the command to run.

- The update check asks the npm registry at most once a day (once an hour after a lookup that failed) and skips CI. `ZITADEL_UPDATE_CHECK=0` turns it off.
- `zitadel doctor` groups its checks into categories (Versions, Local server, Project, Credentials, App integration, Environment) and shows them when a check fails, instead of only an error. `-v` lists every check.
- The command that repairs a warning sits right under it, and the local server's row says whether it is running.
- Every command colors warnings, errors and next steps the same way, and project ids are no longer yellow, so yellow always means a warning. Piped output is unchanged.
