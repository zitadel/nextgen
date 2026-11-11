# Policy catalog

Every operation a policy can guard. The template files under
[`internal/policy/templates/`](../../../apps/api/internal/policy/templates/) are what
the server runs; this index is what a reviewer reads. The two must agree, and
adding an operation adds a row here ([ADR 066](../../adrs/066-operation-policies.md#policy-catalog)).

## `auth.factor.password.set`

Evaluated before a password is stored, whichever path stores it.

| | |
|---|---|
| Template | [`auth.factor.password.set.json`](../../../apps/api/internal/policy/templates/auth.factor.password.set.json) |
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

## `user.create`

Evaluated before a sign-up creates a user, on the public plane
([ADR 088](../../adrs/088-abuse-protection-per-operation.md)). The guard, the
signup proof of work and its per-flow limits, applies with or without a
policy; the policy chooses the challenge and never switches the guard off.

| | |
|---|---|
| Template | [`user.create.json`](../../../apps/api/internal/policy/templates/user.create.json) |
| Settings | `challenge` (one of `zitadel_pow`); optional, omitted means the guard's own challenge |
| Config rules | none |
| Rules | `challenge`, named after the setting it reads |
| Context | `solved_challenge`: the challenge the request's proof solved, after the guard verified it |
| Context builder and gate | `service.UserCreatePolicy.Challenge` (which challenge a sign-up step issues) and `service.UserCreatePolicy.CheckSolved` (whether the solved one is it), called by `service.SignupProtection` |
| Instance resolution | `service.PolicyService.ResolvePolicy`, as for `auth.factor.password.set` |
| Denial | `flow.proof_invalid` (403), as for a missing or spent proof: the client refreshes the step and gets the challenge the policy names. No violations, as the live error carries none |
| Default policy | [`default-user-create-policy.json`](../../../packages/config/defaults/default-user-create-policy.json): the guard's challenge, written by `zitadel setup` and deployed by the platform project; `TestDefaultUserCreatePolicy_EqualsTheGuard` keeps it equal to `domain.SignupGateProvider` |
| Values tied to | `domain.SignupGateProvider` (the enum offers it; `TestUserCreateTemplate_OffersTheGuardsChallenge`) |
| Domain guards, not policy | the proof of work on every password or passkey sign-up from a flow, and the per-flow issuance and verification limits (`service.SignupProtection`) |
| Call site | `SignupProtection.Challenge` when a sign-up step renders: one whose `on_success` is `create_user`, or one carrying a passkey registration whose stored challenge is provisional. `SignupProtection.Consume` when the first submits, and in `FlowAuthAttemptAdapter.SubmitPasskeyRegistration` before the second's attestation creates the user. Not gated: user creation through the API, whose credentialed callers are never challenged (ADR 088 §3), and sign-up through a sign-in provider, which needs an account at the provider |
