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
| Context | `candidate.length`: code points of the NFC-normalized candidate; `history_matches`: one entry per kept password, current first, at most `history_depth` |
| Bounds kept equal to | `domain.MaxPasswordLength` (length), `domain.UserPasswordHistoryDepth` (history) |
| Domain guards, not policy | non-empty, at most 64 code points (`domain.HashPassword`) |
| Gate | `service.SetPasswordUserAction.Prepare`, before the hash: admin API, registration, SSO sign-up. Not wired yet ([#1448](https://github.com/zitadel/nextgen/issues/1448)) |
| History applies | only when the user sets their own password; no such path exists yet |
