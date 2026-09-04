---
"@zitadel/cli": patch
---

`zitadel claim` against a CLI-launched local server (`--server local`) now opens the claim page on the local server itself instead of a remote default: the CLI passes the server's public base when it starts the binary or docker runtime. When a manually started loopback server still advertises a remote claim page, `claim` warns and names the `NEXTGEN_SERVER_PUBLIC_BASE` setting to fix it.
