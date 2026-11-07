---
title: zitadel auth-method says what to change, and what it keeps
summary: The commands that turn password, passkey and SSO sign-in on and off now say which flow steps to change, what they keep, and what an SSO setup would write, and accept a schema by the name flows use.
date: 2026-11-06T23:31Z
pulls: [2750, 2751, 2753, 2754, 2755, 2758, 2756]
---

The `zitadel auth-method` commands now tell you what to do next, instead of only that something is left:

- `password enable` and `passkey enable` say what to add to which flow file when no login flow offers the method yet.
- `password disable` and `passkey disable` say, when a login flow still uses the method, what each step keeps without it, which purpose it starts and which transitions lead to it.
- `sso disable` says what it keeps (the provider's connection file, which every deploy still publishes, its credential variables and its sign-in steps) and how to remove the file and the variables. With `--provider` naming a provider the project does not have, such as a typo, it fails with `E_NOT_FOUND` and lists the ones it has, instead of reporting success.
- `sso enable --dry-run` prints the callback URI and where to register the OAuth client, and lists the files and credential variables the real run would write (`would_store` in `--json`), without asking for credentials.
- `--schema` accepts a user schema's `objectType`, the name login flows use, as well as its file name.

The READMEs `zitadel setup` writes in `.zitadel/schemas/` and `.zitadel/flows/` name these commands and show how a flow step offers each method.

[Turn password and passkey sign-in on and off](https://preview.zitadel.com/docs/guides/sign-in-methods)
