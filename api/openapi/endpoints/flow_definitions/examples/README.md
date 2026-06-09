# Flow Definition Examples

Working examples of flow definitions accepted by `POST /flow-definition`. Each
example exercises a different slice of the engine's currently supported
capabilities, ordered from minimal to combined.

Examples are templates: `${PROJECT_ID}` and `${USER_SCHEMA_URL}` are substituted
at the point of use (see `embed.go` for the in-tree substitution helper).

For the engine's capability surface, see
[`docs/design/flowengine/capabilities.md`](../../../../../docs/design/flowengine/capabilities.md).
For the shape and validation rules, see
[`docs/design/flowengine/flow-definition-rules.md`](../../../../../docs/design/flowengine/flow-definition-rules.md).

## Index

| # | Folder | Purposes | Demonstrates |
|---|---|---|---|
| 01 | [password-login](./01-password-login/) | `login` | Identifier → password, terminal `show`. The minimal login flow. |
| 02 | [password-register](./02-password-register/) | `register` | Single-step signup with `on_success: create_user`. |
| 03 | [passkey-login](./03-passkey-login/) | `login` | Discoverable passkey login — single action, no identifier. |
| 04 | [passkey-register](./04-passkey-register/) | `register` | Usernameless passkey signup — provisional user pattern. |
| 05 | [combined-password](./05-combined-login-register/) | `login` + `register` | Flip-table coverage: `user_not_found` and `user_already_exists` wired on entry steps. |
| 06 | [combined-all-methods](./06-combined-all-methods/) | `login` + `register` | Password + passkey on both purposes, passkey upsell after password signup, terminal `redirect`. |

The existing `default-login-flow-definition.json` at the root of this folder is
embedded by the server as the default project flow; it mirrors example 06 but
uses terminal `show`.

## Reading a definition

A flow definition is a directed graph. The engine derives step behavior from
the properties present on the step — there is no step `type`:

- A step with `fields` collects user input validated against the
  `user_schema`. Schema annotations (`x-unique`, `x-password`,
  `x-auth-methods`) drive implicit dispatch behavior at runtime.
- A step with `actions` exposes user-selectable buttons. Two action names are
  engine-handled — `passkey` (login) and `passkey_register` (signup) — and
  trigger the two-phase WebAuthn ceremony.
- `on_success: create_user` mutates server state after fields validate, before
  transitions fire. The validator checks every kind in the writer manifest is
  collected somewhere upstream.
- `complete: show` or `complete: redirect` marks a terminal step.
- `transitions` keys are action names declared on this step **or**
  engine-emitted outcomes (`user_not_found`, `user_already_exists`,
  `callback`).

## What's not shown

These examples cover only what the engine can run today. The following are
either stubbed (`ErrUnsupported`) or not built yet, and don't appear in the
ladder:

- Cross-flow transitions (`switch`, `pivot`).
- SSO providers and `callback` handling.
- Gates (e.g. CAPTCHA).
- Magic-link, email/SMS OTP, TOTP.
- Recovery (`reset_credential`), SSO linking, factor enrollment.

See `capabilities.md` for the full inventory.
