# Bot Detection & Captcha

> **Status:** Contract decided in [ADR 019](../../adrs/019-captcha-gate-and-bot-signals.md); risk-based activation still depends on policy engine design
> **See also:** [Overview](README.md) · [Flow Engine](flow-engine.md) · [Session API](session-api.md) · [ADR 019](../../adrs/019-captcha-gate-and-bot-signals.md)
> **POC ADRs:** [021](https://github.com/zitadel/oxidel/blob/main/docs/adr/021-login-flow-schema.md) Bot Detection & Telemetry, [024](https://github.com/zitadel/oxidel/blob/main/docs/adr/024-risk-evaluation-policy-consumers.md) Risk Evaluation

> **Runtime status:** CAPTCHA is not implemented. Flow definitions can store a
> gate, but the engine emits `gates: {}`, does not require a proof, and rejects
> non-empty `gate_proofs` with `flow.unsupported`. The provider, risk, and
> `auth_attempts` ceremonies below describe the intended contract.

Bot detection is a **first-class, composable subsystem** — not an afterthought bolted onto login.

## Principles

1. **Self-hosted by default.** Altcha (proof-of-work) ships built-in with zero external dependencies. No data leaves the deployment unless the admin opts in to a third-party provider.
2. **Pluggable providers.** Admins can configure third-party captcha services (reCAPTCHA, hCaptcha, Cloudflare Turnstile) via `x-captcha.provider`. The captcha interface is provider-agnostic.
3. **Composable signals.** Captcha is one of several signals. The risk evaluator fuses them into a single `RiskResult`.
4. **Risk-based activation.** Captcha is not always-on. The policy engine decides when to require it.
5. **Works in both paths.** Flow engine injects captcha steps dynamically. Direct clients drive the same captcha challenge through `auth_attempts` when risk evaluation demands it.

## Signal Architecture

```
┌─────────────────────────────────────────────────┐
│                   Risk Evaluator                 │
│                                                  │
│  Inputs:                                         │
│    * Captcha result (solved / not solved)         │
│    * Device fingerprint (known / new / spoofed)   │
│    * Behavioral telemetry (timing, interaction)   │
│    * Rate limit state (attempts per IP/user)      │
│    * Request context (geo, ASN, TLS)              │
│                                                  │
│  Output: RiskResult                              │
│    score: 0.0-1.0                                │
│    level: low | medium | high | unknown          │
│    reasons: []                                   │
│    recommendation: allow | require_captcha |     │
│      require_step_up | block                     │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
              Policy Engine consumes
              RiskResult and decides
```

Do not read stored event metadata or `GET /events` as a risk-evaluator
signal. Path A `request.api` requestor context is best-effort audit export
for SIEM join on `request_id`, not a request-time input.

### Platform / edge signals

Apps deployed behind an edge platform (e.g. Cloudflare, Vercel, Netlify) often already
run bot management there — Cloudflare managed challenge / WAF, Vercel BotID, etc. —
producing a **server-side verdict with no widget**. The provider list is open; the
contract is provider-agnostic. That verdict is a first-class signal:

- **Capture:** the SDK Edge proxy (`/__nextgen`, running in the customer's deployment)
  reads the platform verdict server-side and stamps it on the proxied flow request as the
  reserved header `X-Zitadel-Risk-Signal` (structured-field: `provider`, `level`, optional
  `score`/`reasons`).
- **Trust:** Zitadel honors the header only when the request also carries a valid
  origin-scoped `sk_proj_` secret (the `ZITADEL_PREVIEW_SECRET` already provisioned to the
  deploy platform — see [secret.md](../platform/secret.md)). Browser-relayed signals are
  ignored.
- **Effect:** the risk evaluator fuses it like any other signal — a `clean` verdict can
  suppress an otherwise-required captcha; a `suspicious` verdict can inject one.

Full contract and trust model: [ADR 019](../../adrs/019-captcha-gate-and-bot-signals.md).

## Captcha Providers

The captcha subsystem is **provider-agnostic**. The flow definition or schema annotation specifies which provider to use. The server generates challenges and verifies solutions using a provider-specific adapter.

### Built-in: Altcha (Proof-of-Work)

The default captcha. Self-hosted, zero external dependencies, privacy-preserving.

```
Server                              Browser
------                              -------
Generate challenge:
  salt = random(16)
  secret = HMAC-SHA256(server_key, salt)
  number = random(0..max_number)
  challenge = SHA256(salt + number)
  -> send { algorithm, challenge,
           salt, max_number }
                                    Brute-force solve:
                                      for n in 0..max_number:
                                        if SHA256(salt + n) == challenge:
                                          -> send { number: n, salt }

Verify:
  recompute = SHA256(salt + number)
  valid = (recompute == challenge)
  -> record result in risk evaluator
```

| Parameter | Default | Purpose |
|---|---|---|
| `difficulty` | `3` (1-6 scale) | Computational cost. Higher = harder. |
| `max_number` | `100_000` | Upper bound for brute-force range. |
| `expiry` | `300s` | Challenge validity window. |

Difficulty scales with risk level. `medium` risk → difficulty 2 (subsecond). `high` risk → difficulty 5 (several seconds).

### Third-Party Providers

Admins can configure external captcha services when they need ML-based detection or have compliance requirements that mandate a specific vendor.

| Provider | `x-captcha.provider` value | How it works |
|---|---|---|
| **reCAPTCHA** (Google) | `recaptcha` | Server sends site key → browser renders widget → token submitted → server verifies via Google API |
| **hCaptcha** | `hcaptcha` | Same flow as reCAPTCHA, verified via hCaptcha API |
| **Cloudflare Turnstile** | `turnstile` | Invisible or managed challenge → token submitted → server verifies via Cloudflare API |

Third-party providers require configuration (site key, secret key) at the project or team level. The captcha step in the flow response includes provider-specific config so the frontend knows which widget to render:

```json
{
  "kind": "captcha",
  "provider": "recaptcha",
  "config": {
    "site_key": "6Lc..."
  }
}
```

vs. the built-in Altcha:

```json
{
  "kind": "captcha",
  "provider": "altcha",
  "config": {
    "algorithm": "SHA-256",
    "challenge": "abc...",
    "salt": "xyz...",
    "max_number": 100000
  }
}
```

The frontend dispatches on the gate's `provider` to render the right widget. The submit payload varies by provider (Altcha sends `{ salt, number }`, reCAPTCHA/hCaptcha/Turnstile send `{ token }`).

### Schema Annotation

Captcha is configured per flow via `x-captcha` in the flow definition or schema:

```json
{
  "x-captcha": {
    "provider": "altcha",
    "mode": "risk_based",
    "difficulty": 3
  }
}
```

| Field | Values | Meaning |
|---|---|---|
| `provider` | `altcha`, `recaptcha`, `hcaptcha`, `turnstile` | Which captcha service to use |
| `mode` | `always`, `risk_based`, `disabled` | When to show the challenge |
| `difficulty` | `1`-`6` (Altcha only) | PoW computational cost |

## Fingerprinting

Browser fingerprinting collects device signals for risk correlation. It does not block — it feeds the risk evaluator.

- **Provider:** ThumbmarkJS (open-source, self-hosted) with fallback to a minimal built-in collector.
- **Collection:** Flow engine emits a fingerprint collection action. Frontend submits via `POST /flow/{id}/event` (direction — the event endpoint is not in the shipped spec).
- **Persistence:** Fingerprint hash stored on the session. Repeat visitors with the same fingerprint on the same user are lower risk.

## Behavioral Telemetry

| Signal | Captured via | Risk indicator |
|---|---|---|
| Keystroke timing | Event endpoint | Bots type at constant intervals |
| Mouse movement | Event endpoint | Bots move in straight lines or not at all |
| Time on step | Step transition timestamps | Bots complete forms in <100ms |
| Copy/paste of credentials | Event endpoint | Unusual for real users on password fields |

Signals are submitted via `POST /flow/{id}/event` (direction — the event endpoint is not in the shipped spec). They are **observation-only** — never blocking on their own.

## Rate Limiting

| Scope | Limit | Effect |
|---|---|---|
| IP + endpoint | Configurable (e.g., 20/min) | 429 Too Many Requests |
| User + factor | Configurable (e.g., 5 attempts/10min) | Factor locked, risk score elevated |
| Session | Configurable (e.g., 10 mutations/min) | Session throttled |

Exceeding soft limits elevates risk (triggering captcha). Exceeding hard limits blocks.

## Integration: Flow Engine

Three modes:

1. **Step-level gate** — for flows that always want captcha (e.g., public registration):

```json
   {
     "name": "profile",
     "fields": ["email", "given_name", "family_name"],
     "gates": {
       "captcha": { "kind": "captcha", "provider": "altcha" }
     },
     "actions": [
       { "name": "submit", "kind": "submit", "primary": true }
     ],
     "transitions": {
       "submit": { "target": "set-password" }
     }
   }
```
   
The intended contract makes the frontend solve the configured CAPTCHA before
submission. Today's runtime does not emit or enforce the declaration.

2. **Dynamic injection (planned)** — policy evaluates risk and injects a captcha gate on any step dynamically, even if the definition doesn't declare it.

3. **Risk-based activation (planned)** — the engine evaluates risk after every submit. Low score → proceed. High score → inject captcha gate on the current or next step.

## Integration: Auth Attempts

When the risk evaluator flags an auth attempt, the policy engine requires a
captcha challenge. The captcha proof does not affect the session's
`assurance_levels[]` — it is a bot-detection gate, not an authentication factor.

The client:
1. Receives a flow step or policy response requiring `"captcha"`
2. Requests a challenge: `POST /auth_attempts/{id}/challenges { "method": "captcha" }`
3. Solves the challenge client-side (widget or PoW depending on configured provider)
4. Submits the proof: `POST /auth_attempts/{id}/challenges/{cid}/verify { "captcha": { ... } }`

Captcha is a standard challenge type — no special-case API.

## Risk Evaluation Event

```json
{
  "event_type": "signal.risk_evaluated",
  "score": 0.72,
  "level": "high",
  "reasons": ["new_device", "rate_limit_elevated", "geo_mismatch"],
  "recommendation": "require_captcha",
  "session_id": "sess_abc",
  "fingerprint": "fp_abc",
  "ip": "1.2.3.4"
}
```
