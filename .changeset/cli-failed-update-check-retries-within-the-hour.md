---
"@zitadel/cli": patch
---

The update check that `zitadel doctor` and `zitadel --version` run asks the npm registry again within the hour after a lookup that failed, instead of waiting a day, so one failed request no longer hides a new release. `zitadel upgrade` now also tells you to check that the registry serves the release's dist-tag when the registry answers but does not name the latest release.
