---
"@zitadel/cli": minor
---

`zitadel doctor` now groups its checks into categories with color, and shows them when a check fails instead of only an error. It also says when a newer CLI exists, and so does `zitadel --version` in a box with the command to run. The new `zitadel upgrade` moves the project's exactly pinned `@zitadel/*` packages to the latest release, shows the breaking changes on the way, and refreshes generated files. The update check asks the npm registry at most once a day, skips CI, and `ZITADEL_UPDATE_CHECK=0` turns it off.
