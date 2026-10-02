---
"@zitadel/cli": patch
---

Every command now accepts `-v` as the short form of `--verbose`, matching the convention agents already expect from curl, ssh, and wget. The long `--verbose` is unchanged, and the root `--version` keeps no short form, so nothing collides.
