# Policy catalog

Every operation a policy can guard. The template files under
[`internal/policy/templates/`](../../../internal/policy/templates/) are what
the server runs; this index is what a reviewer reads. The two must agree, and
adding an operation adds a row here ([ADR 066](../../adrs/066-operation-policies.md#policy-catalog)).

## `auth.factor.password.set`

Evaluated before a password is stored, whichever path stores it.

| | |
|---|---|
| Template | [`auth.factor.password.set.json`](../../../internal/policy/templates/auth.factor.password.set.json) |
| Settings | `min_length` (1 to 64), `max_length` (1 to 64), `history_depth` (1 to 4); all optional, omitted means off |
| Config rules | `min_length_not_above_max_length` |
| Rules | `min_length`, `max_length`, `history_depth`, each named after the setting it reads |
| Context | `candidate.length`: code points of the NFC-normalized candidate; `self_service`: the user sets their own password; `history_matches`: one entry per kept password, current first; the rule reads only the first `history_depth` |
| Context builder and gate | `service.PasswordPolicy.CheckPassword` |
| Instance resolution | `service.PolicyService.ResolvePolicy` (a `service.PolicyResolver`): the revision the request's release pins, none when it pins none, none when the project published none |
| Denial | `user.password_policy_violation` (400) with `{ "violations": {...} }` in `details.details`; a password over the cap is reported as `max_length` with the effective maximum. In a flow (registration, SSO sign-up), field errors on the step that creates the user; a length violation is refused earlier, on the step that collects the password |
| Flow step bounds | `service.PasswordPolicy.PasswordLengthBounds` (a `domain.FlowPasswordPolicy`): `min_length` and `max_length` on the password field of a step where the user chooses one, the cap when unset |
| Bounds tied to | `domain.MaxPasswordLength` (length bounds equal it); `domain.UserPasswordHistoryDepth` (history bound at most it plus the current password) |
| Domain guards, not policy | non-empty (`user.password_empty`, checked by the gate before the policy) and at most 64 code points (reported by the gate as `max_length`; `domain.HashPassword` keeps the check as the backstop) |
| Call site | `service.SetPasswordUserAction.Prepare`, before the hash: admin API, registration, SSO sign-up. Not gated: the bootstrap user import, which stores given hashes |
| History applies | only when the user sets their own password (`SetPasswordInput.SelfService`, read by the rule as `self_service`); no self-service path exists yet. The constraints projection still lists `history_depth`, since it needs no context |
