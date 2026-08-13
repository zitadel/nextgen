# Vision

Zitadel's next generation is an identity platform built for developers and
the AI agents that work beside them. The promise, in one line:

**You own the experience. Zitadel guards the state.**

Registration, login, and every screen around them live in your app — your
code, your brand, your framework. Behind them stands a single API that holds
what must never live in an app: credentials, sessions, and tokens, kept with
the discipline of a dedicated identity service. Policy spans the two on
purpose: you define it, as code, and Zitadel enforces it. Most identity
products force a choice between a hosted UI you don't control and hand-rolled
auth where every mistake is yours. This platform exists so you never have to
make that choice.

## Why agent-native

A growing share of software is written with an agent in the loop, yet
identity vendors still assume a human who can click through a signup form,
verify an email, and paste a client ID into `.env`. An agent can do none of
that reliably — and a developer shouldn't have to.

Agent-native is not about shipping AI features. It means every capability of
the platform is a contract a machine can discover, call, and verify:
structured input, structured output, deterministic behavior, no hidden
steps. Those are the same properties that make a platform pleasant for
people. What serves the agent serves the developer.

## Still a customer identity platform

None of this changes what Zitadel is for. It is customer identity and access
management (CIAM): the people who register through your app — consumers in
B2C, organizations and their members in B2B — remain the center of gravity.
Agents arrive alongside them, not instead of them.

And they arrive in more than one role. At build time, an agent scaffolds
your auth and manages your resources the way any developer would. At run
time — the long-term goal — an agent becomes a subject of the platform
itself: a principal with its own identity and lifecycle, a client that signs
in as itself, a delegate acting on a user's behalf. Delegation, never
impersonation: an audit trail that names the user when an agent acted is a
lie, and the delegation chain keeps it honest. One agent is often all of
these within a single task, so the primitives must compose — and every
action, whoever took it, should land in the same identity-scoped events.

## What this repository is

This preview rebuilds Zitadel's storage core and API surface — work that
cuts too deep to land incrementally in the main repository. It happens here
instead, in the open, and is intended to merge back into
[zitadel/zitadel](https://github.com/zitadel/zitadel) as the foundation of a
future major version. This is a preview of Zitadel — not a separate product,
not a fork.

## The four pillars

Everything the platform does serves four capabilities, and each builds on
the one before it.

### 1. Build — auth you own

Add registration and login to an app without giving up the experience.
Headless APIs and framework SDKs carry the flow; ready-made UI components
are there when you want them, never required. Your app renders every screen;
the server holds every secret. And because working auth should come before
any signup, the direction is create-first, claim-later: build now, claim
ownership when it starts to matter.

### 2. Operate — one contract, every surface

Everything Zitadel can do is defined once and reachable everywhere — HTTP
API, CLI, MCP, console — same operations, same semantics, same permissions.
A human clicks what a script pipes and an agent calls; nothing is
dashboard-only.

One contract does not mean one workflow. What defines your system — schemas,
flows, policies — is configuration: code in your repository, reviewed,
planned, applied. What the system accumulates by being used — registered
users, sessions, tokens, events — is data: reached through the same
contract, operated on rather than declared. The boundary is intent versus
record. A bootstrap admin belongs in code; the users who register through
your app are the record of its success, and no repository should try to
hold them.

### 3. Investigate — events answer questions

Identity activity should be a dataset, not a log file. When every
authentication, session, check, and change lands as a structured,
identity-scoped event, forensics stops being an archaeology project and
becomes a task you hand to an agent: who accessed what, through which
delegation, what changed in the hours before an incident. Your events, your
agents — analysis through open interfaces, with no black box in between.

### 4. Govern — accountable agents

Products now ship with agents inside, and the companies building them
inherit a question network operators answered for humans long ago with AAA:
authentication, authorization, accounting. Agents need the same treatment in
every role they take. Give an agent an identity of its own, let it sign in
as itself, record the delegation chain — which user granted which scope to
which agent — and account for every action taken on someone's behalf. Any
product with agents in it must be able to answer: who authorized this agent
to do what, and did it stay within scope?

## Where it stands

This repository is pre-release, and the pillars sit at different depths
today.

Shipped: the CLI takes an app from zero to working local auth
([README.md](README.md)) and speaks agent first — every command supports
`--non-interactive --json` and returns a structured envelope, with
[apps/cli/SKILLS.md](apps/cli/SKILLS.md) as the contract agents consume
([ADR 004](docs/adrs/004-agent-contract-and-agents-md.md)). Framework SDKs
live under [packages/](packages/). The OpenAPI 3.1 sources under
[api/openapi/](api/openapi/) are the contract of record, configuration is
repo state with `plan` and `apply`
([ADR 035](docs/adrs/035-configuration-environments.md)), and the docs
site publishes LLM-readable text at `/llms.txt` and answers documentation
queries over MCP. `zitadel claim` and the claim lifecycle behind
create-first, claim-later are shipped
([ADR 046](docs/adrs/046-claim-lifecycle-v2.md)): the server serves the
claim endpoints and the CLI drives the ceremony, reports team attachment,
and verifies it in `doctor`.

Direction: [ADR 003](docs/adrs/003-create-first-claim-later.md) records the
withdrawal of the earlier mock-only claim lifecycle, and the design notes
describing the hosted claim service beyond the shipped endpoints remain
target design. Management operations over MCP are still ahead;
whether the CLI or MCP becomes the primary agent transport is deliberately
open, because the contract is the invariant and transports compete on
ergonomics. The storage core records auth attempts, sessions, checks, and
tokens, but the unified event stream and query surfaces of pillar 3 are not
built yet, and the delegation primitives of pillar 4 are target design on
standards that are still stabilizing: token exchange, actor claims, MCP
authorization.

Further out lies AI inside the platform itself — anomaly detection, threat
intelligence, assisted configuration. That work is exploratory and will
arrive as design documents before it arrives as code.
