---
"@zitadel/cli": patch
---

`zitadel setup` asks fewer, clearer questions. It asks which port your app runs on only when that port is already in use. The server question asks which Zitadel server your app should use, and lists the local server even when it is not running, saying to run `zitadel start` first. The minimum password length is now a choice of 15 characters (recommended), 8 or none, instead of a number to type, and the sign-in summary shows it. After picking a sign-in provider, leaving its client ID empty skips that provider and prints the `zitadel auth-method sso enable` command that adds it once its OAuth app exists, instead of making you cancel setup. Answering no to "Would you like to set up Zitadel in this app?" now tells you to run setup in the app you meant. Pressing Ctrl-C at any prompt exits with code 130 and no error message, like Ctrl-C elsewhere in the CLI.
