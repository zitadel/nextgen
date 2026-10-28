---
"@zitadel/server": minor
---

`POST /policies/evaluate` evaluates an operation's policy as a dry run: it takes a config, the operation's input (for the password policy, the password itself) and the facts the operation would look up (`self_service`, `history_matches`), and answers whether the operation would go ahead. A refusal carries the error code and violations the live operation answers with, such as `user.password_policy_violation` with `{"min_length": 12}` or `user.password_empty`, because the server runs the password set's own check, NFC normalization and the 64-character cap included. Nothing is read from or stored in the project; an invalid config is refused with `pol.invalid`, as on publish.
