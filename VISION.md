# Vision

Zitadel's next generation is an identity platform designed for two kinds of
builders: developers, and the AI agents that increasingly work beside them.
Both get the same promise:

**You own the experience. Zitadel guards the state.**

Registration, login, and every screen around them live in your app — your
code, your brand, your framework. What must never live in your app stays in
Zitadel: credentials, sessions, and tokens, held with the durability and
security discipline of a dedicated identity service. Policy spans the two on
purpose: you define it, as code, and Zitadel enforces it. Most identity
products force a choice between a hosted UI you don't control and hand-rolled
auth where every mistake is yours. This platform is built so you never have
to make that choice.

## Why agent-native

A growing share of software is written with an agent in the loop, yet
identity vendors still assume a human who can click through a signup form,
verify an email, and paste a client ID into `.env`. An agent can do none of
that reliably — and a developer shouldn't have to.

Agent-native is not about shipping AI features. It means every capability of
the platform is a contract a machine can discover, call, and verify:
structured input, structured output, deterministic behavior, no hidden steps.
Those are the same properties that make a platform pleasant for people, which
is why this vision never separates the two audiences. What serves the agent
serves the developer.

## Still a customer identity platform

Agent-native does not change what Zitadel is for. This is customer identity
and access management (CIAM): the people who register through your app —
consumers in a B2C product, organizations and their members in a B2B one —
remain the center of gravity. Agents do not replace them. They arrive
alongside them, as a class of actor that needs the same rigor humans already
get.

"Agent" also means more than one thing to an identity platform, and the
pillars below serve every meaning:

- **The builder** scaffolds working auth into an app (pillar 1).
- **The operator** inspects and manages resources through the same contract
  humans use (pillar 2).
- **The principal** holds an identity of its own, with access rights and a
  lifecycle: provisioned, rotated, revoked, retired (pillar 4).
- **The client** authenticates as itself to use a product, the way a coding
  agent signs into an API (pillar 4).
- **The delegate** acts on a user's behalf with explicitly granted,
  attributable authority (pillar 4) — delegation, never impersonation. An
  audit trail that names the user when an agent acted is a lie; the
  delegation chain keeps it honest.

One agent is often several of these within a single task — client in one
call, delegate in the next. Classic IAM assumes a principal with a stable
role; agents are polymorphic principals, and the primitives that serve them
have to compose. The run-time roles share pillar 4's status: long-term goal,
target design.

## What this repository is

This preview rebuilds Zitadel's storage core and API surface — work that cuts
too deep to land incrementally in the main repository. It happens here
instead, in the open, and is intended to merge back into
[zitadel/zitadel](https://github.com/zitadel/zitadel) as the foundation of a
future major version. This is a preview of Zitadel — not a separate product,
not a fork.

## The four pillars

Four capabilities describe what the platform is for, and each builds on the
one before it: build, operate, investigate, govern.

### 1. Build — auth you own

Add registration and login to an app without giving up the experience.
Headless APIs and framework SDKs carry the flow; ready-made UI components are
available when you want them and never required. Your app renders every
screen; the server holds every secret.

**Today:** the CLI scaffolds auth into an app against a local runtime (see
[README.md](README.md)), framework SDKs live under [packages/](packages/),
and the embedded login and console UIs double as working references.

**Direction:** create-first, claim-later — working auth before any signup,
and a free claim once ownership starts to matter.
[ADR 003](docs/adrs/003-create-first-claim-later.md) records where the
implementation stands; `zitadel claim` is not shipped, and design notes that
describe it are target design.

### 2. Operate — one contract, every surface

Everything Zitadel can do is defined once and reachable everywhere: HTTP API,
CLI, MCP, and console UI expose the same operations with the same semantics
and the same permissions. A human clicks what a script pipes and an agent
calls — nothing is dashboard-only.

One contract does not mean one workflow. Resources that define the system —
schemas, flows, policies, applications, roles — are configuration: declared
as code in a repository, reviewed, planned, and applied. Resources the system
accumulates by being used — registered users, sessions, tokens, events — are
data: reachable through the same CLI and APIs, operated on rather than
declared. The boundary is intent versus record. A bootstrap admin or a
service account expresses intent and belongs in code; the users who register
through your app are the record of its success, and no repository should try
to hold them.

**Today:** the OpenAPI 3.1 sources under [api/openapi/](api/openapi/) are the
contract of record. Every CLI command runs with `--non-interactive --json`
and returns a structured envelope, and
[apps/cli/SKILLS.md](apps/cli/SKILLS.md) is the contract agents consume
([ADR 004](docs/adrs/004-agent-contract-and-agents-md.md)). Configuration is
repo state that can be planned and applied
([ADR 007](docs/adrs/007-gitops-configuration-surface.md)), and the docs site
publishes LLM-readable text at `/llms.txt` and page-level `.md` URLs.

**Direction:** management operations exposed over MCP. Whether the CLI or MCP
ends up as the primary agent transport is deliberately open — the contract is
the invariant, and transports compete on ergonomics.

### 3. Investigate — events answer questions

Identity activity should be a dataset, not a log file. When every
authentication, session, check, and change lands as a structured,
identity-scoped event, forensics stops being an archaeology project and
becomes a task you can hand to an agent: who accessed what, through which
delegation, and what changed in the hours before an incident.

**Today:** the storage core records structured identity activity — auth
attempts, sessions, checks, token issuance — but no unified event stream or
query surface exists yet.

**Direction:** a first-class event stream with query and export surfaces
built for agent-driven analysis, through open interfaces: your events, your
agents, no black box between them.

### 4. Govern — accountable agents

Products now ship with agents inside, and the companies building them — B2C
or B2B — inherit a question network operators answered for humans long ago
with AAA: authentication, authorization, and accounting. Agents need the same
treatment in every run-time role they take — principal, client, delegate.
Give an agent an identity of its own, let it authenticate as itself, record
the delegation chain — which user granted which scope to which agent — and
account for every action it takes on someone's behalf. Any product with
agents in it must be able to answer: who authorized this agent to do what,
and did it stay within scope?

This is the platform's long-term goal. It is target design, not shipped
capability: the standards underneath (token exchange, actor claims, MCP
authorization) are still stabilizing, and these primitives build on the event
foundation of pillar 3.

## Current reality

This repository is pre-release. The checked-in CLI supports the local
npm-binary setup flow documented in [README.md](README.md), with Docker as an
explicit fallback runtime. There is no `zitadel claim` command and no cloud
service; the pillar sections above mark what is direction rather than
shipped.

Further out, past the four pillars, lies AI inside the platform itself —
anomaly detection, threat intelligence, assisted configuration. That work is
exploratory and will arrive as design documents before it arrives as code.
