---
"@zitadel/server": patch
"@zitadel/server-linux-x64": patch
"@zitadel/server-linux-arm64": patch
"@zitadel/server-darwin-x64": patch
"@zitadel/server-darwin-arm64": patch
"@zitadel/server-win32-x64": patch
---

`zitadel-server migrate` no longer generates a master key. Migrations never use one, so running them, for example as a one-off job before a deployment, no longer leaves a throwaway `master-keys/master-key.pem` in the data directory or logs a warning about it. The server itself still generates a key on its first start when none is configured.
