---
"@zitadel/cli": patch
---

`zitadel setup` asks fewer, clearer questions: your app's port only when that port is taken, and the server with the local one listed even when stopped. An empty client ID skips that sign-in provider and prints the `zitadel auth-method sso enable` command that adds it later, and Ctrl-C at any prompt exits with code 130 and no error.
