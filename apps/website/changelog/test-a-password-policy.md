---
title: Test your password policy before you deploy it
summary: zitadel policies test runs the cases you write beside a policy and checks each against what Zitadel decides, and POST /policies/evaluate answers the same question for any policy config.
date: 2026-10-29T07:54Z
pulls: [2353, 2350]
---

Write the passwords your policy should accept and refuse in `.zitadel/policies/<operation>.test.json`, and `zitadel policies test` runs them against the policy file beside them. Zitadel evaluates every case as a real password set would, so a case also covers how a password is counted. `--release <id>` runs the cases against the policy a built release pins, before you deploy it.

- A case gives the operation's input (for the password policy, the password itself), optionally the facts the operation would look up (`self_service`, `history_matches`), and the decision it expects: `allowed`, and optionally the error `code` and exactly the `violations`.
- A failing case fails the command with `E_VALIDATION` and lists what was expected and what Zitadel decided.
- `zitadel deploy` never carries the test files. Editors check them against `.zitadel/meta/policy-test.json`, and the policies README that `zitadel setup` writes shows an example.

`POST /policies/evaluate`, live on preview.zitadel.com since 28 October, is the dry run underneath. It takes a policy config, the operation's input and the facts it would look up, and answers whether the operation would go ahead. A refusal carries the error code and violations the live operation answers with, such as `user.password_policy_violation` with `{"min_length": 12}`, because the server runs the password set's own check, NFC normalization and the 64-character cap included. Nothing is read from or stored in the project.

[zitadel policies test](https://preview.zitadel.com/docs/reference/cli/policies/test), [Evaluate a policy in the API reference](https://preview.zitadel.com/docs/reference/api/policies/evaluatePolicy)
