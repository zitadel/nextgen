# ADR 078: Abuse Prevention in Four Layers — Edge, Guards, Policies, Challenges

> **Status:** Proposed
> **Date:** 2026-10-23
> **Context:** How the server, and whatever runs in front of it, limit request
> volume, credential guessing, account enumeration and bots, on the hosted
> cloud and self-hosted. Answers [#351](https://github.com/zitadel/nextgen/issues/351)
> and replaces the unmerged [#472](https://github.com/zitadel/nextgen/pull/472),
> which was written for the GCP-hosted cloud and deferred everything past the
> edge.
> **Related:** [ADR 010](010-session-auth-attempt-check-model.md),
> [ADR 019](019-captcha-gate-and-bot-signals.md),
> [ADR 030](030-error-model-mapping-and-reporting.md),
> [ADR 036](036-api-credential-planes.md),
> [ADR 048](048-wide-events-internal-audit-primitive.md),
> [ADR 066](066-operation-policies.md),
> [ADR 077](077-api-path-prefix.md)

## Context

### What runs today

| Area | State |
|---|---|
| Edge, hosted cloud | Vercel's automatic DDoS mitigation and nothing else: the Vercel API has no firewall configuration for the `cloud` project, so no WAF rule and no rate limit. #472's Cloud Armor rule (3000 requests per address per 60 s, a ban at 9000 per 180 s) belonged to the legacy cloud on GCP; this cloud runs on Vercel and PlanetScale ([runbook](../runbooks/cloud.md)). |
| Edge, self-hosted | Whatever the operator runs. The docs suggest nothing. |
| Server | Enforces no limit. Eight operations declare `429` (`createProject`, `completeClaim`, `getClaimStatus`, `getClaimWindow`, `createGrant`, `createTeam`, `queryProjects`, `queryTeams`) and the API reference lists them as rate-limited; no handler returns it ([#1266](https://github.com/zitadel/nextgen/issues/1266)). |
| Failed proofs | `recordProofFailure` stores the failure and emits a failed `auth.check` event; nothing reads either. [#1434](https://github.com/zitadel/nextgen/pull/1434) (open) adds a per-user password backoff that counts those events. |
| Policies | The ADR 066 engine ([#1878](https://github.com/zitadel/nextgen/pull/1878) to [#2279](https://github.com/zitadel/nextgen/pull/2279)) guards `auth.factor.password.set` only. A policy has no server default: a project without an instance has no policy. |
| Challenges | ADR 019's contract (built-in Altcha, a project's own captcha provider, `X-Zitadel-Risk-Signal`) is not wired: the runtime step carries no gates and the state machine refuses `gate_proofs` as unsupported. |
| Client address | `clientIP` believes the left-most `X-Forwarded-For` hop from any peer ([#802](https://github.com/zitadel/nextgen/issues/802)). |

### What the hosted cloud changes

- Vercel overwrites `X-Forwarded-For` with the connecting address; keeping a
  proxy's value needs Vercel's Enterprise Trusted Proxy. A request relayed by
  a customer's SSR middleware or `vercel.json` rewrite therefore reaches the
  server, and the WAF, from the relay. Every user of that app shares one
  address, and relays on Vercel egress from addresses other Vercel customers
  share.
- On Pro, WAF rate limits count per address or JA4 fingerprint, in fixed
  windows of 10 s to 10 min, per region. Header keys and token buckets need
  Enterprise; custom keys from code need `@vercel/firewall`, a JavaScript
  package.
- A challenge, from Attack Mode or a WAF rule, stops clients that are not
  browsers: the CLI, the SDKs' server-side calls, any standalone API client.
- BotID's server check, `checkBotId()`, ships in the `botid` npm package for
  JavaScript projects; the login UI is served by the Go server. Basic checks
  are free; Deep Analysis costs US$1 per 1,000 checks on Pro.

### What the reviews of #472, #1356 and #1434 settled

- Parallel guesses. A count read before the hash and written after it lets
  parallel guesses through (#472's review, and Copilot's on #1434), and
  hashing inside a transaction holds a connection for the length of the hash.
  #1434 now locks and recounts after the hash (§3).
- No tarpit. A delayed response holds a connection: function concurrency on
  Vercel, which is billed, container concurrency on GCP.
- Push the cost to the client, with a proof-of-work whose difficulty rises
  with failures ([#1356](https://github.com/zitadel/nextgen/issues/1356)).
- A lockout keyed on the user confirms the account exists, lets anyone lock
  its owner out, and moves the attacker on to the next account (#1356).

## Decision

### 1. Four layers, one owner each

| | Layer | Runs | Owner | Counts | Tuned by |
|---|---|---|---|---|---|
| 1 | Edge | in front of the server | the deployment: Zitadel on the cloud, the operator self-hosted | requests, by address or TLS fingerprint | the deployment |
| 2 | Guards | in the server, always on | Zitadel | recorded security events, by account, project or principal | the operator, in server config; never a project |
| 3 | Policies | in the server ([ADR 066](066-operation-policies.md)) | the project, in its release | nothing: decides on the guards' counts | the project, stricter only |
| 4 | Challenges | flows and auth attempts ([ADR 019](019-captcha-gate-and-bot-signals.md)) | Zitadel ships them, the project picks the provider | nothing | the project |

- No layer relies on another to be safe. A server with nothing in front of it
  still has its guards; a guard with no challenge available refuses instead.
- Volume belongs to layer 1, meaning to layers 2 to 4. The server never counts
  requests in its database, since a write per request would make the limiter
  the cheapest way to overload it. A guard counts events the server records
  for the audit trail: a failed check, a failed claim, a sent code.

### 2. Layer 1: the edge stays coarse

The edge sees addresses, never identifiers, factors or outcomes, and on the
cloud it often sees a customer's relay rather than their users. It does what an
address allows and no more.

On the hosted cloud, Vercel WAF rules on the `cloud` project:

- One limit per address on every path the server answers, at the legacy
  cloud's 3000 requests per 60 s, answered with `429`.
- One tighter limit per address on the two operations that take no
  credential, `createProject` and `getClaimWindow`. The CLI and the console
  call them directly rather than through a relay, so the address is the right
  key.
- Each rule starts with Vercel's `Log` action and enforces once a week of
  traffic shows no customer relay near it.
- No challenge on API paths. Attack Mode is an incident switch for browser
  paths, written up in the runbook.
- The rules are project state, not deployment state; the
  [runbook](../runbooks/cloud.md) lists them. Scoping them by path gets
  simpler once [ADR 077](077-api-path-prefix.md) puts the API under
  `/api/v1/`.

Self-hosted, Zitadel ships no edge. The self-hosting docs carry the same two
rules for nginx, Caddy, Traefik, Envoy and Cloudflare, keyed by address (an
IPv6 address by its /64), and the header each one sets for §6.

### 3. Layer 2: guards are built in and always on

A guard is a check in the operation's own path, like ADR 066's domain guards:
on for every project, its defaults in code, tunable by the operator in server
config and never by a project. That keeps
[#898](https://github.com/zitadel/nextgen/issues/898)'s "not configurable by
Projects in MVP".

A guard keeps no counter of its own. It counts the events its operation
records ([ADR 048](048-wide-events-internal-audit-primitive.md)):

| Guarded | Counted event | Key | Over the limit | Today |
|---|---|---|---|---|
| A knowledge-factor check: password now; OTP, email and SMS codes, recovery codes as they land | `auth.check.failed` since the last `auth.check.succeeded` | (project, user, factor) | challenge, then refuse | #1434 counts it for passwords |
| `completeClaim` | a failed completion | the project being claimed | refuse | no event on failure yet; declares `429`; [ADR 046](046-claim-lifecycle-v2.md) requires the limit |
| `createGrant` by identifier | a request, hit or miss | (project, principal) | refuse | only a hit writes an event; declares `429`; #1266 |
| Sending a code or link by email or SMS | a send | (project, destination) | refuse | nothing sends yet; the first sender ships with its guard |

How a guard counts:

- **Count events, keep no counters.** A refused attempt writes no counted
  event, so no key ever holds more counted events than its limit, and a count
  is an indexed scan bounded by the limit rather than by the attack. Nothing
  exists only to count: no table to keep, clean or reconcile, and what limited
  a caller is what the project reads in its events.
- **Lock, count, verify, lock, recount.** #1434's pattern. A short
  transaction on the primary locks the credential's row and counts; the hash
  runs outside any transaction; a second transaction locks again and recounts.
  A check that no longer fits under the limit is refused whatever the hash
  said, so parallel guesses get no answer past the limit, and no transaction
  stays open across an argon2id hash. A check with no slow hash, such as a
  claim's challenge, does all of it in one transaction.
- **Only synchronous events count.** A counted event is written in its
  operation's transaction; the batched request events never count. A storage
  contract test ([ADR 041](041-storage-statement-contract-tests.md)) pins each
  counted type to that path, so moving one to a batch fails a test instead of
  silently switching a guard off.
- **Retention has a floor.** `events.retention.window` (30 days by default,
  [ADR 049](049-events-api-retention-export.md)) may not be shorter than the
  longest guard window; the server refuses to start with one that is.
- **One index per key.** Each key gets an index in every dialect, as #1434's
  password index does: a partial expression index on Postgres and SQLite, a
  generated column with a `NULL_FILTERED` index on Spanner. If guards
  multiply, one `rate_key` column on `events`, set only on counted events,
  serves them all from one index (an amendment to ADR 048).

How a guard answers:

- **Price, then refuse.** Past the soft count the step requires a challenge
  whose difficulty grows with the count (§5); past the hard count the factor
  is refused until the count decays. Each factor counts on its own, so a
  throttled password leaves passkeys working. Until §5 is wired a guard
  refuses where it would challenge, which is the backoff #1434 implements.
- **Answer the same for every identifier.** Identifier resolution answers
  `not_found` today, an oracle this ADR does not close. Once it is closed, a
  check on an identifier no user has writes the same failed event under a
  hash of the normalized identifier and is serialized like a real account's
  (with no row to lock: an advisory lock on Postgres, the read-write
  transaction on Spanner, SQLite's single writer), so its answers match one.
- **Sample the refusals.** The first refusal per key and window writes one
  `throttled` event, which nothing counts; later ones only reach metrics. A
  flood of refusals never becomes a flood of writes.
- **Fail closed on secrets, open on quotas.** A guard in front of a secret (a
  factor, a claim) fails its operation when its events cannot be read; a
  quota lets the request through and logs.
- **Bound the hash.** Each instance caps concurrent password-hash
  verifications and answers past the cap with `503` and `Retry-After`.
  argon2id is memory-hard, and an unauthenticated caller decides how many run
  at once.

What a guard does not count:

- **Request-shaped limits stay at the edge.** Where the abuse is request
  volume rather than a recorded security event (anonymous `createProject`,
  claim polling, `createTeam`, the queries), there is no event to count, or
  counting one would take a write per request. The edge limits them (§2); the
  server adds no limit of its own.
- **Large counts stay off the request path.** Counting events suits limits of
  tens per window. A signal over a whole project, such as its failure rate, is
  read from the events by a periodic job ([ADR 065](065-background-jobs.md))
  rather than per request (§8). A quota of thousands that must hold exactly
  on every request, such as a project-wide send quota against SMS pumping,
  keeps one GCRA row per key: a single timestamp, updated in place. None is
  in the first set.

### 4. Layer 3: policies tighten guards, never replace them

- ADR 066 holds: a Zitadel template per operation, the project's instance,
  CEL rules, a stateless engine, and no server defaults. The last rule is why
  a policy cannot be the baseline: a project that publishes none would have no
  protection. A policy is how a project asks for more than the guard gives: a
  lower count, a lockout instead of a backoff (PCI DSS 4.0.1's ten attempts and
  thirty minutes, out of MVP per #898 and tracked in
  [zitadel#6502](https://github.com/zitadel/zitadel/issues/6502)), a challenge
  on every sign-up, a challenge whenever the edge reports `suspicious`.
- The `auth.check` template, ADR 066's illustrative catalog row, reads the
  guards' counts and the risk signal from its context. Go counts, CEL decides.
- Each count setting is bounded by the guard's value and tied to it by a test,
  the way ADR 066 ties `max_length` to `domain.MaxPasswordLength`, so an
  instance can only be stricter.
- Three items of ADR 066's future work become prerequisites of that template:
  a rule whose setting is never disclosed, since a threshold in `constraints`
  tells an attacker how many guesses are free; an outcome besides `deny`, to
  require a challenge and name its difficulty; and the `audit` enforcement
  mode, to watch a stricter policy before it blocks.
- Not MVP. #1434's fixed numbers become the guard's defaults now and the
  template's bounds later, so no API that sets them ever has to be withdrawn,
  which #1356 made the condition for shipping #1434.

### 5. Layer 4: one challenge contract, several signals

> **Proposed amendment (2026-10-29), [ADR 084](084-hosted-cloud-business-systems.md) §5.**
> The hosted cloud's own sign-in takes the option this section leaves open:
> its console routes the sign-in widget's calls through a JavaScript function
> (`apps/cloud-functions`), which runs `checkBotId()` on the two flow writes,
> as a customer app on Vercel would. Until ADR 019's runtime reads the risk
> signal, that function refuses a bad verdict, a block on the cloud's edge
> where this section allows only a signal; ADR 084 keeps the choice open.

- ADR 019 stands. Its built-in Altcha proof-of-work is the default everywhere
  and the whole answer for a self-hoster: no third-party account, no data
  leaving the deployment, an HMAC check to verify. It is also how a guard
  prices guesses: the difficulty grows with the guard's count, so a guesser
  pays in CPU and the server holds nothing open. Any client can solve it, a
  script included; it prices a guess, it does not prove a human.
- A project that already uses Turnstile, hCaptcha or reCAPTCHA brings its own
  keys (ADR 019).
- Edge verdicts are signals, never blocks. A customer app on Vercel calls
  `checkBotId()` in its SSR middleware and forwards the verdict as
  `X-Zitadel-Risk-Signal`, which the server trusts only with the origin-scoped
  secret (ADR 019 §2; ADR 036 keeps that channel for SSR deployments). A
  Cloudflare bot score travels in the same header. A `clean` verdict can waive
  a challenge and a `suspicious` one can require it. Deep Analysis is billed to
  the customer's own Vercel account.
- The hosted cloud's own login UI uses Altcha, as a self-hosted one does.
  BotID there would need a JavaScript function in front of the Go service; it
  stays an option, so the cloud keeps behaving like a self-hosted server.
- The whole layer waits on ADR 019's runtime: gates on the runtime step,
  `gate_proofs` verified through `auth_attempts`, and `<zl-captcha>`.

### 6. The client's address

- A forwarded address counts only when the peer that sent it is a trusted
  proxy, read right to left past trusted hops (#802). Otherwise anyone writes
  the address the server records and the allow-list (§8) reads.
- No guard in §3 keys on the address. Behind a relay (an SSR middleware, a
  `vercel.json` rewrite, a worker) the server sees the relay, an attacker
  rotates addresses while a victim behind a carrier NAT shares one, and
  volume per address is the edge's job (§2). An SSR middleware may still pass
  the user's address next to the risk signal, trusted under the same rule, so
  sessions and events record the user rather than the relay.

### 7. What a limited caller gets

- `429` with the ADR 030 envelope, the code `req.rate_limited` and
  `Retry-After`. The details name no key, count or threshold. A flow shows it
  as a step error carrying the wait.
- A factor check's refusal looks the same for every identifier (§3), so it is
  no oracle.
- Quotas on the app and operator planes also send the `RateLimit-Policy` and
  `RateLimit` fields of the IETF HTTPAPI draft, in place of the
  `X-RateLimit-*` headers the [API conventions](../design/api/conventions.md)
  plan. Guards on the public plane send only `Retry-After`: the attempts left
  are information for the attacker.
- No tarpit. The server never delays a response to slow its caller; it
  refuses with `Retry-After` or prices the next attempt (§5).
- An operation declares `429` only when a guard in the server answers it, with
  the envelope. The edge answers any path with its own `429`, which the API
  reference describes once for all operations. `completeClaim` and
  `createGrant` keep their declarations with their guards; the six others
  (`createProject`, `getClaimStatus`, `getClaimWindow`, `createTeam`,
  `queryTeams`, `queryProjects`) lose theirs.

### 8. Seeing and stopping an attack

- A refusal writes a wide event naming the guard or rule (ADR 048), once per
  key and window (§3), and so does a challenge a guard or policy requires. A
  project sees an attack in the Events API
  ([ADR 049](049-events-api-retention-export.md)), and an `audit` policy has
  something to record. Operators get metrics per guard, never per key.
- Server config carries an allow-list of networks and credentials the guards
  skip: the benchmark harness ([ADR 067](067-benchmark-harness-http-path-ownership.md)),
  a customer's announced load test, CI.
- An operator-only switch requires a challenge on every public-plane step of
  one project. It is the in-app counterpart of Vercel's Attack Mode, which a
  self-hosted server does not have and which covers every project on the cloud
  at once.
- Spraying, a few guesses at each of many accounts, stays under every
  account's count. A periodic job reads each project's failure rate from its
  events and, past a threshold, turns that switch on for a while.

## Recommended sequence

1. The cloud's edge: the two Vercel rules in `Log`, then enforced, and the
   runbook. Independent of everything else.
2. The first guards: #1434 with §7's answer, the retention floor and the
   sampled `throttled` event; then `completeClaim` and `createGrant` by
   identifier, each with the event it is missing (#1266).
3. The `429` contract: `req.rate_limited` with `Retry-After`, and the
   declarations no guard answers removed.
4. #802's trusted proxies, so the address the server records and the
   allow-list reads is the client's.
5. ADR 019's runtime with Altcha; the guards gain their challenge step, and
   the spraying job a switch to turn on.
6. The self-hosting docs' reference edge configurations.
7. The `auth.check` policy template, after ADR 066's undisclosed rules,
   `require` outcome and `audit` mode.
8. The send guard, with the first code or link Zitadel sends.

## Consequences

### Positive

- Every deployment is protected against credential guessing, with or without
  an edge or a policy.
- No counter state: what limited a caller is what the project reads in its
  events, and no table or job exists only to count.
- A self-hoster gets bot protection with no third party; Vercel's and
  Cloudflare's verdicts make challenges rarer and are never required.
- Policies keep ADR 066's "no server defaults" without leaving a project
  unprotected.
- Request volume never reaches the database as writes.

### Negative and risks

- A factor check takes the credential row's lock twice and counts twice;
  parallel checks of one account queue on that lock.
- The guards lean on the audit trail: a counted event can never move to the
  batched path, and retention can never drop below the longest window. A test
  and a startup check hold both.
- Someone guessing at an account can keep its owner's password refused, at
  the price of the challenges up to the hard count. Passkeys keep working.
- The edge's limits per address are weak against residential proxy networks;
  the challenge carries that load.
- Vercel counts its rate limits per region.
- The cloud's own login forgoes BotID's Deep Analysis until a JavaScript
  function stands in front of it.
- Until ADR 019's runtime lands, a guard can only refuse.

## Open questions

- [NIST SP 800-63B-4 §3.2.2](https://pages.nist.gov/800-63-4/sp800-63b.html)
  limits consecutive failures with one authenticator on one account to 100,
  "by disabling that authenticator". #898 claims NIST alignment and also
  requires recovery without an administrator. Is the hard count 100 with
  self-service recovery, or a refusal that decays? The password change and
  recovery journeys are deferred
  ([#1353](https://github.com/zitadel/nextgen/issues/1353)).
- The numbers: soft and hard counts, decay, the windows and the edge limits.
  Security signs them off (#898), starting from #1434's.
- Targeted lockout, if it is abused: a device that has signed in before gets
  an allowance of its own through a signed device cookie, OWASP's answer to
  it.
- Request quotas per project on the shared cloud, against a noisy neighbour.
  No incident has needed one, and on Pro the edge cannot key on a project. If
  one is needed, it is §3's large quota: a GCRA row.

## Alternatives considered

- **The edge only (#472).** The edge cannot see identifiers or outcomes, sees
  a relay instead of the user on the cloud, and leaves a self-hosted server
  without an edge with no protection at all.
- **Guards as policies with server defaults.** Reverses ADR 066's decision on
  defaults and hides an enforced value in the server.
- **An account lockout** (Zitadel's lockout policy, PCI DSS). Locks the owner
  out on the attacker's schedule and needs someone to lift it. A project may
  opt in later, as a policy.
- **A tarpit** (Zitadel today). Holds connections; see §7.
- **A counter row per key** (this ADR's first draft). A write besides the
  event on every check, a cleanup job for stale rows, and a second record that
  can disagree with the audit trail. Its one advantage, an atomic
  test-and-increment, is matched for these guards by #1434's lock and
  recount. Kept for large quotas only (§3).
- **Redis or Valkey for the counts.** A second stateful dependency for every
  self-hosted deployment, for counts the events already hold. Revisit only if
  a guard ever has to count requests in the server.
- **Keying the factor guard on the client's address too** (this ADR's first
  draft). Events carry no address, and an address separates owner and
  attacker poorly (§6). A device cookie does it better, if it is ever needed.
- **An event for every refusal.** Turns a flood of refused requests into a
  flood of writes; one per key and window shows the attack as well.
- **Vercel BotID as the cloud's bot protection.** A JavaScript-only check in
  front of a Go service, billed per check for Deep Analysis, and a cloud that
  behaves unlike a self-hosted server.
