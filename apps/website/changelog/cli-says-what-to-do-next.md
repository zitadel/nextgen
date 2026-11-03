---
title: The CLI tells you what to do next
summary: Running zitadel alone groups the commands by what you are doing, and start, setup and auth-method sso enable ask plainer questions and say what to run next.
date: 2026-10-27T23:26Z
pulls: [2348, 2323, 2371, 2366, 2367]
---

Running `zitadel` alone now lists the commands under six headings named for what you are doing, one row per family such as `users` or `release`. `zitadel users --help` lists its operations, every command's help ends by pointing at the overview, and `zitadel commands` still prints the flat list.

- `zitadel start` points to `zitadel setup` instead of a console link. `setup` spells out every choice and shows the sign-in configuration before writing it, and `auth-method sso enable` says to `deploy` the provider, then test sign-in.
- `zitadel setup` asks for your app's port only when that port is taken, and lists the local server even when it is stopped. An empty client ID skips that sign-in provider and prints the `zitadel auth-method sso enable` command that adds it later. Ctrl-C at any prompt exits with code 130 and no error.
- Every question reads as a plain question, such as "What is the client ID of your Google OAuth app?", and the client secret question says which project variable will hold it.
- `zitadel auth-method sso enable --provider custom` asks at a terminal for the connection's name, its sign-in button's name, the issuer URL and the scopes you leave out, instead of failing with a list of flags; scripts still need the flags. A new custom connection prints its claim mappings and the file to edit them in.
- The note about Zitadel's agent skills shows once per machine.

**Breaking:** `zitadel start --json` no longer has `data.console`, and its `next_actions` and `next_commands` no longer mention the console. Run `zitadel console --json` for `data.sign_in_url`.

[zitadel auth-method sso enable](https://preview.zitadel.com/docs/reference/cli/auth-method/sso/enable)
