---
"@zitadel/cli": minor
---

`zitadel setup` now gives every new project a password policy with a minimum length of 15 characters, NIST's minimum for passwords used without a second factor. A run with `--non-interactive`, `--json` or no terminal gets the same policy as one where you answer the questions. Pass `--password-min-length` to choose another minimum, or `0` for none.

**Breaking:** a scripted `zitadel setup` used to publish a password policy with no minimum. If your scripts or tests register users with passwords shorter than 15 characters, use longer ones, or pass `--password-min-length` with the length you need.
