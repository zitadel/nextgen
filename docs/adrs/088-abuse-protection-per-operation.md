# ADR 088: Abuse Protection per Operation

> **Status:** Draft
> **Date:** 2026-11-05
> **Context:** How rate limits, quotas, challenges, bot signals and abuse
> signals combine, where a project configures them, and what a caller without
> a UI gets. Follows the signup proof of work in
> [#2626](https://github.com/zitadel/nextgen/pull/2626), the first guard.
> **Related:** [ADR 019](019-captcha-gate-and-bot-signals.md),
> [ADR 035](035-configuration-environments.md),
> [ADR 036](036-api-credential-planes.md),
> [ADR 048](048-wide-events-internal-audit-primitive.md),
> [ADR 062](062-per-environment-variables-and-secrets.md),
> [ADR 066](066-operation-policies.md),
> [ADR 078](078-abuse-prevention-in-layers.md)
> **Amends:** ADR 019 §1 (where a gate is configured), ADR 066 (outcomes and
> modes), ADR 078 §4 and §5

## Context

- ADR 078 splits abuse prevention into four layers: the edge, guards in the
  server, project policies and challenges. ADR 066 gives a project one policy
  file per operation, `.zitadel/policies/<operation>.json`, deployed in a
  release. ADR 019 declares challenges as `gates` on flow steps.
- #2626 ships the first guard: a proof of work the server attaches to every
  step whose `on_success` is `create_user`, with fixed per-flow limits.
  Nothing about it is configurable, and it marks the definition's `gates`
  field reserved.
- Missing: one model for how the mechanisms combine, one home for a
  project's settings, and an answer for operations no UI calls.
- Other products split two ways. Where the check is a step in an editable
  flow (Keycloak, authentik, Descope, Ping journeys, Azure AD B2C custom
  policies), a flow that leaves the step out has no check, and none of them
  warns. Most bind it to the server's operation or surface instead (Auth0,
  Okta, Supabase, Google Identity Platform, Ory Network).
- Vercel's WAF challenges only browsers. A solved challenge covers the
  browser's API calls for an hour; scripts, `curl` and other clients fail it
  and need a bypass rule, a rate limit or a deny. Its rate limits count per
  address or JA4 fingerprint on Pro; header keys, token buckets and windows
  over ten minutes need Enterprise, and a key chosen in code needs the
  `@vercel/firewall` package.

## Decision

### 1. One decision per operation

Before a protected operation runs, the server makes one decision from three
kinds of input:

- **Counters:** events per key and window, counted from the events the
  operation records (ADR 078 §3). A rate limit is a counter with a short
  window, keyed by an identifier or a destination. A quota is one with a long
  window, keyed by a project, an app or an agent.
- **Bot signals:** a verdict on this one request, such as a solved proof of
  work, a CAPTCHA provider's score or the edge's verdict (ADR 019 §2).
- **Abuse signals:** facts gathered across requests, such as failed checks,
  codes sent and never verified, sign-ups per email domain, disposable
  domains and network reputation.

The decision ends in one outcome: **allow**, **challenge** (prove something
first) or **refuse** (`429` with `Retry-After` as in ADR 078 §7, or `403`).
Every challenge and refusal writes a wide event naming the guard or rule
(ADR 078 §8), and the counters read those events back. A policy in `audit`
mode makes the same decision and records it without enforcing it.

Capacity, the requests per second a project may send, is not part of this
decision. It belongs to the edge (ADR 078 §2), and raising it never loosens a
guard.

### 2. Protection binds to the operation, never to a flow step

- A policy names an operation: `user.create`, `auth.check`, and the send
  operation once Zitadel sends codes, named as ADR 066 names operations.
- Every path to an operation gets the same decision: each flow that creates a
  user, and the API.
- A flow shows the challenge a decision asks for as a runtime gate on the
  step that submits the operation, the shape #2626 already sends
  (`step.gates.signup_pow`). The flow definition carries no protection, and
  its reserved `gates` field is removed with the first policy-driven gate.

### 3. Callers without a UI

What a decision may ask for depends on who calls, by ADR 036's planes:

| Caller | Example | Can be challenged with | Otherwise |
|---|---|---|---|
| A browser in a flow (public plane) | sign-up, sign-in, recovery | the built-in proof of work, a CAPTCHA provider, step-up MFA | refuse |
| A client without a browser (public plane) | the CLI creating a project, a native app's sign-in | the built-in proof of work, solved by the SDK or the CLI | refuse |
| A credentialed caller (app or operator plane) | creating a user through the API, token exchange | nothing: the credential names the caller | refuse, with limits keyed on the credential |

- Outside a flow, a challenge is an error whose details carry the challenge.
  A client that can solve it retries with the proof; a browser flow gets the
  same challenge as a runtime gate.
- An interactive CAPTCHA exists only in a browser. A native app without one
  could prove itself with platform attestation later (open question 3).
- Credentialed callers are never challenged, as Supabase's `service_role`
  and Clerk's Backend API are not. Limits still apply to them, keyed on the
  credential rather than the address.
- Each template declares which outcomes it supports on which plane, and
  `zitadel deploy` rejects a policy that asks for a CAPTCHA where no browser
  can call.

### 4. Two owners, two homes

| | Guards | Project policy |
|---|---|---|
| Owner | the operator | the project |
| Home | server config, with defaults in code (ADR 078 §3) | `.zitadel/policies/<operation>.json` and `.zitadel/protection.json` |
| Can | set the floor | tighten only (each count is bounded by the guard's, ADR 078 §4), choose providers, set lists and quotas |
| Example | #2626's proof of work and per-flow limits | a lower sign-up limit, Turnstile on sign-up, a daily SMS cap |

- ADR 066's "no server defaults" still holds: the server applies no policy a
  project did not deploy. The guards are the baseline instead (ADR 078 §4),
  and the default policy writes them down (§5).
- **Per operation**, `.zitadel/policies/<operation>.json` (the ADR 066
  instance): limits, the challenge and its strength, and what each signal
  does, for that one operation.
- **Per project**, `.zitadel/protection.json`: what several operations share.
  That is challenge providers with their keys as `${{ NAME }}` secrets
  (ADR 062), the trust for the edge's verdict (ADR 019 §2), and named lists
  (email domains, SMS countries, networks) that policies refer to.
- Both are release resources (ADR 035): reviewed, deployed and rolled back
  with the flows.
- A project's admins can read the effective protection, guards included,
  from the CLI, the console and `zitadel deploy`'s output. Public callers
  never see a threshold (ADR 078 §7).

An illustration; names and fields settle in the implementing PR:

```jsonc
// .zitadel/protection.json
{
  "providers": {
    "turnstile": { "site_key": "0x4AAAAAAA…", "secret": "${{ TURNSTILE_SECRET }}" }
  },
  "edge_verdict": { "source": "vercel_botid", "secret": "${{ ZITADEL_RISK_SIGNAL_SECRET }}" },
  "lists": {
    "disposable_domains": { "kind": "email_domain", "values": ["mailinator.com"] }
  }
}

// .zitadel/policies/user.create.json
{
  "operation": "user.create",
  "mode": "audit",
  "config": {
    "limits": [{ "key": "email_domain", "max": 50, "per": "1h", "then": "challenge" }],
    "challenge": { "provider": "turnstile" },
    "refuse_email_domains": "disposable_domains",
    "edge_verdict": { "on_bot": "refuse" }
  }
}
```

### 5. A free default policy

Every project has the same protection before it configures any: the guards.
For `user.create` that is #2626's built-in proof of work on every password
sign-up from the public plane, and its per-flow limits. Every pricing plan
includes it. Sign-up with a passkey or through a sign-in provider is not
challenged yet.

- Zitadel ships the guards' values as a default policy, as it ships the
  password policy's (`packages/config/defaults/default-password-policy.json`).
  `zitadel setup` writes it to `.zitadel/policies/user.create.json` and the
  platform project deploys it. A project reads its protection in its own
  files and changes it there.
- The default sets exactly the guards' values, and a test keeps the two
  equal, as ADR 066 ties `max_length` to `domain.MaxPasswordLength`.
  Deploying the default changes nothing, and neither does deleting it: a
  project without the file has the guards, never nothing.
- A stronger free baseline is therefore a stronger guard. A setting only the
  default held would be lost with the file.
- Where an operator has raised a guard, the guard applies, and the effective
  protection (§4) shows it.
- The default uses only settings every pricing plan includes (§7).

### 6. What ADR 066 grows

All four are in ADR 066's future work:

- an outcome besides `deny`: `challenge`, with a named output for its
  strength;
- the `audit` mode;
- settings never disclosed to the caller, such as thresholds;
- context built from event counts per key and window.

Rules a project writes itself over signals, beyond a template's own rules,
stay out of this ADR; settings come first.

### 7. Entitlements

Whether a setting needs an entitlement is the catalog's decision, not this
ADR's. A project that deploys the default policy (§5), or none, needs none.
`zitadel deploy` reports a setting the project's pricing plan does not include
and names what would include it. A preview environment may accept it, so a
project can try it first.

Metered usage is counted from the same events. A decision that allows a
request because an external provider's check or the edge's verdict passed
writes one event, so a check counts once per decision, however many requests
of the flow carried it. A check that fails, and a request the decision
refuses, never count: an attack must not grow the project's usage.

## Consequences

- A flow cannot lose protection by leaving a step out, and the API gets the
  same decision as the flow.
- A project's files show its protection from `zitadel setup` on. Every
  project without a change of its own has the same: the default, which is the
  guards.
- One vocabulary and one event trail for limits, quotas, challenges and
  signals, and an `audit` mode for every change before it enforces.
- Every protected operation needs a template, a context builder and its
  outcomes per plane, kept in parity with the wire schema (ADR 066's test).
- Quotas with long windows keep a counter per key. ADR 078 §3 bounds their
  storage (one GCRA row per key for large counts), and so does who may set
  them.
- A client that calls the API without the SDK must handle a challenge error
  or be refused, as #2626 already requires for sign-up.

## Open questions

1. The send operation's name, and whether starting a flow (`POST /flow`) is
   an operation with its own policy.
2. Whether lists can sit inline in a policy, or only in `protection.json`.
3. Platform attestation (App Attest, Play Integrity) as the bot signal for
   native apps without a browser.
4. Rules a project writes over signals: when, and in which file.

## Implementation sequence

One GitHub stack, each PR on the one below:

1. #2626: the signup proof of work, the first guard.
2. This ADR.
3. The `user.create` template and its default policy (§5), written by
   `zitadel setup` and deployed by the platform project.
4. The `audit` mode, each decision a wide event (§1).
5. The challenge as an API error, solved by the SDKs, for callers without a
   browser.
6. CAPTCHA providers and the edge verdict (ADR 019 §1 and §2), configured in
   `.zitadel/protection.json`, and each policy validated per plane at deploy
   (§3): the built-in proof of work is the only challenge until then, and
   every plane that can be challenged can solve it.
7. Entitlements at deploy (§7).
8. `auth.check` and the send operation, as their guards land (ADR 078 §3).
