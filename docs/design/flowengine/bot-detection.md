# Bot Detection & Captcha

> **Status:** Contract proposed in [ADR 019](../../adrs/019-captcha-gate-and-bot-signals.md);
> desktop comparison and protocol core complete, runtime enforcement not implemented.

ZITADEL's built-in operation admission uses the selected ZITADEL-owned
precomputed PBKDF2 v1 protocol, entirely inside the server and browser worker.
No ALTCHA runtime, server or external service is required. Customers can also
bring provider keys or evidence from a registered backend.

The [matched benchmark](pow-matched-benchmark-2026-11-02.md) compares own PBKDF2
and Argon2id with ALTCHA at four increasing levels. Own PBKDF2 is the initial default;
Argon2id remains experimental. The pure Go core now includes the four immutable
PBKDF2 profiles and issuance/verification. Revisioned algorithm selection remains
part of the implementation plan, defaulting to PBKDF2; qualified
algorithms can be added later without replacing admission. The [earlier SHA comparison](pow-benchmark-2026-11-02.md)
is retained as evidence. [ADR 019](../../adrs/019-captcha-gate-and-bot-signals.md)
owns the protocol, public wire format and one-use admission contract; the
[implementation plan and Passwap assessment](bot-protection-implementation.md)
sequence the remaining runtime,
policy, provider and cloud work. Production calibration is still pending.

PoW charges work; it cannot establish that the caller is human. Agents, native
clients and browsers can solve it. Rate budgets, quotas, hard guards and proper
credentials remain essential. CAPTCHA evidence never becomes an authentication
factor or changes session assurance.

The runtime currently emits `gates: {}` and refuses nonempty `gate_proofs`.
Provider declarations do not yet enforce anything. Required admission must live
in the shared operation service, so direct APIs cannot bypass a flow's gate.

Configuration is a revisioned bot-protection resource; operation policies decide
when evidence is required. It is not the old `x-captcha` annotation or an arbitrary
risk score. The current policy engine implements allow/deny for password setting;
its `require`, private-rule and audit capabilities must be added with this consumer.
Baseline guards remain independent of project policy configuration (ADR 078).

Browser fingerprinting, keystroke/mouse telemetry and a generic risk-scoring engine
are not prerequisites or trust anchors for v1. Neither stored event metadata nor
`GET /events` is a request-time risk input: Path A requestor context is best-effort
audit export for SIEM joins. Future signals need their own collection/privacy and
validation design; browser-supplied claims cannot waive required admission.
