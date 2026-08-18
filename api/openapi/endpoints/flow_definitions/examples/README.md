# Flow Definition Examples

Working examples of flow definitions accepted by `POST /flow_definitions`. Each
example exercises a different slice of the engine's currently supported
capabilities, ordered from minimal to combined.

Examples are templates: `${PROJECT_ID}` and `${USER_SCHEMA_URL}` are substituted
at the point of use (see `embed.go` for the in-tree substitution helper).

For the engine's capability surface, see
[`docs/design/flowengine/capabilities.md`](../../../../../docs/design/flowengine/capabilities.md).
For the shape and validation rules, see
[`docs/design/flowengine/flow-definition-rules.md`](../../../../../docs/design/flowengine/flow-definition-rules.md).

## Index

| # | Purposes | Methods | Demonstrates |
|---|---|---|---|
| [01](./01-password-login/) | `login` | password | Minimal login flow. |
| [02](./02-password-register/) | `register` | password | Single-step signup with `on_success: create_user`. |
| [03](./03-passkey-login/) | `login` | passkey | Discoverable passkey login. |
| [04](./04-passkey-register/) | `register` | passkey | Passkey signup with provisional user finalized on verify. |
| [05](./05-combined-login-register/) | `login` + `register` | password | Flip-table coverage between sub-flows. |
| [06](./06-combined-password-passkey/) | `login` + `register` | password, passkey | Both methods on both purposes plus post-signup passkey upsell. |
| [07](./07-nested-profile-fields/) | `register` | password | Nested schema properties collected by dotted path. |

The server's embedded default project flow is
`packages/config/defaults/default-login.json` (via `embed.go`) — that file is
the authority for the default flow's shape. The
`default-login-flow-definition.json` at the root of this folder is a separate
copy that `POST /flow_definitions` still publishes as its `defaultLoginFlow`
OpenAPI example (`externalValue` in `../methods.yaml`); it mirrors example 06
but uses terminal `show`, differs from the embedded default, and — unlike the
numbered examples — is not covered by `TestExampleFlowDefinitions`, so treat
it as illustrative only. Repointing the OpenAPI example at the authoritative
default (or bringing this copy under the test) is a tracked follow-up.

## Reading a definition

A flow definition is a directed graph. The engine derives step behavior from
the properties present on the step — there is no step `type`:

- A step with `fields` collects user input validated against the
  `user_schema`. Schema annotations (`x-unique`, `x-auth-methods`)
  and reserved credential field names (`x-auth-methods#<method>`)
  drive implicit dispatch behavior at runtime. A nested property is named by
  its dotted path (`address.street`) — the object itself has no field-shaped
  input, so collect its leaves.
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
