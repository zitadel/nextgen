---
"@zitadel/cli": patch
"@zitadel/server": patch
---

The local server now starts on Windows, which it did not before because its SQLite location was not a valid URI for a drive path. `zitadel setup` scaffolds beside a running local server instead of renaming its `.zitadel` folder, which Windows refuses while the server holds files open, and `zitadel doctor` no longer reports a file mode Windows cannot hold.
