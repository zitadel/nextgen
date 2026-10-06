---
"@zitadel/cli": minor
---

Add `zitadel auth enable` and `zitadel auth disable`, which turn password or passkey sign-in on or off for a user schema with `--mode password` or `--mode passkey`. Repeat `--mode` to change both. The commands edit only the local schema, and `plan` and `apply` publish the change. They refuse to disable a method that a login flow still asks for, or a schema's last sign-in method.
