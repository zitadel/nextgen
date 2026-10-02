# Releases Without Environments

> **Status:** Spike — [#1389](https://github.com/zitadel/nextgen/issues/1389).
> Design only; nothing here is implemented.
>
> **Question:** can the server drop the environment entity entirely and still
> give a developer somewhere to try a change before it reaches real users?
>
> **Answer this note argues for:** yes. An environment is two separate things
> wearing one name — *which server and project am I talking to*, a client-side
> concern, and *which release am I being served*, a per-request concern. Split
> them and the entity has nothing left to hold.
>
> **Reads against:** [ADR 035](../../adrs/035-configuration-environments.md)
> (releases, environments, deployments),
> [ADR 036](../../adrs/036-api-credential-planes.md) (credential planes, the
> publishable key),
> [ADR 062](../../adrs/062-per-environment-variables-and-secrets.md) (variables
> scoped to an environment),
> [#1311](https://github.com/zitadel/nextgen/issues/1311),
> [#1308](https://github.com/zitadel/nextgen/pull/1308),
> [#536](https://github.com/zitadel/nextgen/issues/536),
> [security and origins](../api/security-and-origins.md),
> [credentials](../api/credentials.md), [project secret](secret.md),
> [configuration surface](configuration-surface.md).

## The claim

ADR 035 defines an environment as a runtime slot that runs one release at a
time. Every job that definition gives an environment is either a pointer (one
release) or a routing rule (which traffic lands here). Neither needs an entity
with a name, a lifecycle, a seeded default set, an expiry, a garbage collector,
and a deployment history of its own.

The two jobs split cleanly:

| Job | Where it goes |
|---|---|
| "Talk to *this* server, about *this* project" | The client, resolved from the process environment and `.env` files. Never travels as a word like `staging`. |
| "Serve *this* release" | The request. Resolved from the exact origin it arrived on, or named explicitly by content hash when there is no origin to resolve from. |

A stage is therefore a `(server, project)` pair that the developer's tooling
already varies per deploy target. A preview is an origin serving a release. The
server never learns the word `production`.

Three things make this cheaper than it sounds.

- **The CLI already has no environments.**
  `apps/cli/src/lib/environment.ts` was deleted in
  [#1286](https://github.com/zitadel/nextgen/pull/1286) — "remove
  `--environment` from the CLI until environments settle" — because its
  `development | preview | production` enum was not the platform's environment
  names and only read a `zitadel.json` key nothing writes.
- **The release content hash already exists.** `domain.Release.ContentHash`
  (`internal/domain/release.go:94-101`) is a SHA-256 over the canonically sorted
  pointer set, versioned `rel-v1`, metadata deliberately excluded, with a unique
  index `uq_releases_project_content_hash` and read-before-insert dedup in
  `internal/service/release.go:92-125`. **The identifier this design needs is
  built and indexed; it is simply not exposed.**
- **The project level of a variable already exists.**
  `domain.VariableOwner.EnvironmentID == ""` *is* the project level — "an
  address of its own rather than a wildcard"
  (`internal/domain/variable.go:160-166`), and it is the default when
  `environment_name` is omitted.

One thing makes it more necessary than it looks: **origin enforcement is
currently vestigial**, and this design is the first thing that would make it
load-bearing. See [the honest state of origins](#the-honest-state-of-origins).

## Three things are called "environment"

Disambiguating these first, because two of them survive and one does not.

| # | Thing | Where | Fate |
|---|---|---|---|
| 1 | **The runtime slot** — `environments` table, `dev`/`staging`/`prod`, `current_deployment_id`, ADR 035 | `internal/domain/environment.go` | **Deleted as a named entity.** Its routing job survives as an [origin row](#origins-the-allowlist-and-the-inventory) keyed by URL instead of by name; its seeded set, naming and lifecycle do not. |
| 2 | **The project's origin-rule class** — a project-level `development \| preview \| production` flag gating which wildcard origin patterns may be saved | [security-and-origins.md §15-43](../api/security-and-origins.md), "LOCKED", **not implemented** | **Survives, renamed and reduced to two values.** See [Project class](#project-class-and-origin-kinds). It is a posture, not a slot. |
| 3 | **The developer's local stage** — `development`/`preview`/`production` as a label selecting which `.env` files and which target to use | CLI, deleted in #1286; `ZITADEL_ENVIRONMENT` in scaffolds | **Survives, client-only.** Never sent to the server. |

Most of the muddle in the current design space comes from these three sharing a
word. The proposal is: delete 1, rename 2, keep 3 local.

## Model after the change

```mermaid
flowchart LR
  P["Project
  class: sandbox | production
  allowed_origins (patterns)
  publishable key
  current_deployment_id"]
  O1["Origin row
  app.acme.com
  current_deployment_id"]
  O2["Origin row
  acme-git-foo.vercel.app
  current_deployment_id, expires_at"]
  R1["Release A
  content_hash, immutable"]
  R2["Release B
  content_hash, immutable"]
  D[Deployment log]
  P --> O1
  P --> O2
  O1 -->|serves| R1
  O2 -->|serves| R2
  P -.->|fallback, no Origin| R1
  P --> D
  D --> R1
  D --> R2
```

**Project.** Unchanged as the data boundary. Carries the authored origin
*patterns* and a `current_deployment_id` that answers callers with no `Origin`
at all — see [Origins](#origins-the-allowlist-and-the-inventory) for why those
are two different things and why both pointers are needed.

**Origin row.** An exact origin that exists right now and the release it serves.
This is the routing record. It is the environment row with its `name` column
deleted — see [the honest accounting](#the-honest-accounting).

**Release.** Unchanged. `ContentHash` becomes the public wire identifier;
`rel_<ULID>` stays as the storage primary key, so
[ADR 047](../../adrs/047-dialect-id-generation.md) is untouched.

**Deployment.** `EnvironmentID` goes; what replaces it is a set of origins —
a deployment is *this release, live at these origins, from this moment.* `reason`
keeps `deploy` and `rollback`; `promote` and `source_environment_id` go — see
[what promotion becomes](#what-promotion-becomes). The idempotence already
implemented (same release → no write, `Created: false`, 200 instead of 201,
`internal/storage/dialect/sqlite/deployment.go:85-88`) and
`expected_current_deployment_id` both carry over unchanged.

**Deleted:** the `environments` table in all three dialects, `environment.go` in
domain / service / api, `DefaultEnvironmentNames`, `SeedDefaults` and its call
from project creation (`internal/service/project.go:173`), the
`environment.created` event and its payload, `ResourceKindEnvironment`, the
`environment.read` scope, `GET /environments[/{name}]`, the `environment_id`
column on `deployments` and on `variables` (with the `environment_ref` generated
column and its composite FK), the `environment_name` query parameter on the four
variable operations, the read-only `zitadel environments list|get` commands, and
the environment-naming half of
[#1311](https://github.com/zitadel/nextgen/issues/1311).

Blast radius is real but bounded: environment appears across domain, three
dialects plus migrations, service, api, and roughly fifteen test files, with
`deployment` and `variable` as the two coupled entities.

## Origins: the allowlist and the inventory

Three questions arrive together and have one answer:

- Should a deployment be related to origins?
- Should the server hold a map of which release each origin serves?
- Is there a difference between the origins a project *allows* and the origins
  that *exist*?

**Yes, yes, and the third one is why the first two are yes.** "Origins" is
currently one word for two things with opposite properties.

| | **Allowlist** | **Inventory** |
|---|---|---|
| What it is | A rule | A fact |
| Written by | A human, in `zitadel.json`, reviewed in a PR | A deploy, by CI |
| Shape | Patterns — `https://*-acmeinc.vercel.app` | Exact origins — `https://acme-git-foo-acmeinc.vercel.app` |
| Lifetime | As long as the project | As long as the deployment it records |
| Question it answers | May traffic from here be served at all? | What is this URL serving? |
| Can it route? | **No.** A pattern matches many hosts. | **Yes.** That is its whole job. |

Conflating them is not a hypothetical problem — it is the bug on `main`.
`project.PreviewOrigins` holds patterns like `*.vercel.app`, and
`validateOriginAgainstProject` compares them by **exact string equality**
(`internal/api/flow.go:371`). So the field is simultaneously a security control
and a routing hint, and because it is checked as neither, its entries match
nothing at all.

### The two records

```
project.allowed_origins: ["https://app.acme.com", "https://*-acmeinc.vercel.app"]
                          -- patterns. authored. gate only.

origin rows:
  { origin: "https://app.acme.com",                  current_deployment_id: dep_1 }
  { origin: "https://acme-git-foo-acmeinc.vercel.app", current_deployment_id: dep_7,
    expires_at: "2026-10-09T00:00:00Z" }
                          -- exact. recorded by a deploy. routes.
```

An origin row is created by a deploy naming where it is going, and it carries the
same `current_deployment_id` column the environment row carries today, with the
same rules: denormalised, no foreign key, written inside the deployment
transaction.

### What this does to resolution

Resolution becomes three layers, each doing one job:

1. **Gate.** Does the request's `Origin` match an `allowed_origins` pattern? No
   → `403`. Wildcards are fine here; gating is the only thing they are good for.
2. **Route.** Is there an origin row for this exact `Origin`? Yes → serve the
   release it points at. **No header, no build-time injection, no client
   involvement whatsoever.**
3. **Fall back.** No origin row — so either a caller with no `Origin` (a
   server-side app, which is the common case behind the scaffolds' proxy), or an
   origin that is allowed but has never been deployed to. Use an explicit
   `X-Zitadel-Release` if present, otherwise the project's
   `current_deployment_id`.

Both project-level and origin-level pointers survive and neither is redundant:
layer 2 needs an `Origin` to match, and a server-side app sends none.

### Three things this fixes

**The client stops needing to know about releases.** Layer 2 means a browser
caller sends nothing new — no `X-Zitadel-Release`, no
`NEXT_PUBLIC_ZITADEL_RELEASE`, no SDK field, no first `X-Zitadel-*` header in
`packages/api/src/runtime/fetch.ts`. Every SDK and scaffold change this note
proposed becomes optional rather than required.

**The capability problem disappears.** A caller no longer *asks* for a release;
it gets what its origin serves. The hash stops being an input on the hot path, so
"knowing the hash is what authorizes serving it" stops being true. On a
`production` project, layer 3's header path can then be refused outright for
uncredentialled callers with nothing lost, because every legitimate browser
caller is answered by layer 2.

**It resolves the hash hinge, in favour of the content hash.** [Open
question 1](#open) weighed an unguessable pointer hash against a reproducible
content hash, and the argument for the pointer hash was that unguessability
protected the uncredentialled pin path. That path is gone. So the hash can be the
*content-equivalence* hash — reproducible across projects — and
[promotion by digest equality](#what-promotion-becomes) becomes checkable. The
user-visible identifier and the CI assertion can be the same value after all.

**It also removes #1311's worst complexity.** #1311 needed "literal origins route,
wildcard origins gate, and a wildcard-reached request must carry
`X-Zitadel-Environment` to disambiguate". Layers 1 and 2 are that rule, minus the
header: a wildcard match is a gate hit with no route, which falls to layer 3
rather than needing the client to break a tie.

### The honest accounting

An origin row is an environment row with the `name` column deleted. It keeps
`current_deployment_id`, `created_at`, an optional `expires_at`, and it needs a
collector. That is most of the entity this note set out to delete, and pretending
otherwise would be dishonest.

The deletion that remains is nonetheless real, and worth being precise about:
**an environment's name was a second identifier for something that already had a
perfectly good globally-unique one — its URL.** Every awkward part of the
environment model was the cost of maintaining that second identifier:

- minting `preview-<name>` and keeping it in step with a branch name
- name uniqueness, collisions, and whether a rename is allowed
- an `origins` array per environment, and keeping it in sync with the name
- idempotent-create-renews-TTL, so `zitadel preview` could be re-run per branch
- `X-Zitadel-Environment`, which exists only because a wildcard-matched origin
  could not say which *name* it belonged to

All of that goes. What is left is a row keyed by the thing the developer already
knows and already owns. The entity does not disappear; the naming layer does, and
the naming layer was the expensive part.

> **This is the decision to make.** Either accept an origin inventory — a routing
> record with a lifecycle, which is #1311 with names removed — and get silent
> previews, no client changes and a reproducible hash; or keep origins as a pure
> allowlist and keep the client-carried hash, with the capability caveat and a
> build-injected release id. The note now argues for the former, but it is a
> genuine trade and the second is still coherent.

## Project class and origin kinds

Two levels, because the hazards sit at two levels. A **project class** says
whether this project serves real users. An **origin kind** says what a
particular entry in its allowlist is for. The class alone cannot express
"production, but previews are welcome", which is the requirement.

```
project.class: sandbox | production

origins: [
  { pattern: "https://app.acme.com",         kind: "primary" },
  { pattern: "https://*-acmeinc.vercel.app", kind: "preview" },
  { pattern: "https://*.preview.acme.com",   kind: "preview" }
]
```

| | `sandbox` (default) | `production` |
|---|---|---|
| Loopback origins (`http://localhost:*`, `127.0.0.1`, `[::1]`) | Allowed | **Rejected at save** |
| Empty allowlist, meaning allow-all | Allowed | **Rejected** — a non-empty allowlist is mandatory |
| `primary` entries | Any known shape | Exact origins only — no wildcards |
| `preview` entries, own domain (`*.preview.acme.com`) | Allowed | Allowed, with domain ownership verification |
| `preview` entries, shared host (`*-acmeinc.vercel.app`) | Allowed, any known host | **Allowed, subject to the [tenant-anchor rule](#the-tenant-anchor-rule)** |
| Release pinning | Open | Requires the publishable key or the project secret |
| Real email / SMS delivery | Claim-gated, a separate axis ([secret.md](secret.md#capability-matrix)) | Same |

**Two class values, not three.** `security-and-origins.md` specifies
`development | preview | production`, but its `development` and `preview` rows
have *identical* origin rules — they differ only in rate limits and dashboard
banners. Rate limiting is its own axis and should not ride on this flag, so the
third value buys nothing and costs a concept. The preview *case* is served by
the origin kind instead, which is where it belongs: a project does not stop
being production because it also has previews.

### Why the class earns its place

Without it, the uncomfortable admission in
[the release resolver](#the-uncomfortable-part-and-how-much-of-it-is-left) — that an
uncredentialled browser caller's release hash functions as a capability —
applies everywhere. With it:

- On a **`production`** project, pinning requires a credential. The publishable
  key suffices, and every preview build has one (it is committed in
  `zitadel.json`, public-safe by construction), so this costs previews nothing
  while making an anonymous pin impossible.
- On a **`sandbox`** project, pinning is open, because local development depends
  on it and the project holds no real users.

### Preview origins on a production project

Allowed, and the reasons to want them are good: a branch build tested against
the real configuration, the real IdP clients, the real variables. Three
constraints apply, and the third is not a policy choice.

**1. A preview must name its release, and registering an origin row is the good
way to do it.** A preview URL silently rendering production configuration is a
footgun, so matching a `preview` pattern must never fall through to the project's
current release. Two ways to satisfy that, and they rank:

- **Preferred — the deploy registers an origin row** for the exact preview URL
  (`acme-git-foo-acmeinc.vercel.app`) pointing at the release it shipped. Layer 2
  of [resolution](#rules) then answers, the client sends nothing, and a stranger
  who reaches a matching wildcard has no row of their own and gets nothing.
- **Fallback — the build injects `X-Zitadel-Release`.** For platforms where no
  registration step is available. Requires the publishable key on a `production`
  project, and leans on the hash being hard to guess.

A `preview` match with neither a row nor a permitted header is `400`, never the
project's current release.

**2. A shared-host wildcard must be tenant-anchored.** See below.

**3. Passkeys registered against production cannot be used on a shared-host
preview.** This is WebAuthn, not us — see
[the RP ID consequence](#the-rp-id-consequence).

### The tenant-anchor rule

`https://*.vercel.app` authorizes *everybody's* Vercel deployments. That is the
hazard, and it is not fixed by hoping the release hash stays secret.

The fix comes from the shape of the hosts themselves. Every preview host puts a
**globally unique, tenant-owned label** in its hostname, and in all three common
cases it sits adjacent to the registrable domain:

| Host | Preview hostname shape | Tenant-unique label | Safe pattern |
|---|---|---|---|
| Vercel | `<project>-<hash>-<team>.vercel.app` | team slug | `https://*-acmeinc.vercel.app` |
| Netlify | `<branch>--<site>.netlify.app` | site name | `https://*--acme-site.netlify.app` |
| Cloudflare Pages | `<hash>.<project>.pages.dev` | project name | `https://*.acme-app.pages.dev` |

> **The rule:** a wildcard may only replace characters to the **left** of the
> tenant-unique label. Every character from that label rightward must be fixed.

The trap is that this reads backwards from intuition. **`https://acme-*.vercel.app`
is not safe** — anyone can create a Vercel project named `acme` under their own
team and deploy to `acme-xyz-attacker.vercel.app`, which matches the pattern.
Anchoring on the prefix is worth nothing on Vercel; anchoring on the suffix is
worth everything. A design that lets a tenant write a wildcard freely will get
this wrong, so the server has to know each host's shape rather than accept any
pattern against an allowlisted domain.

That turns `security-and-origins.md`'s "known safe set" of hosts into something
richer: a registry recording, per host, **where the tenant-unique label sits**,
so a saved pattern can be checked against it. A pattern on an unregistered
shared host is rejected on a `production` project.

**Matcher.** `*` matches one or more characters, none of which is `.`. One rule
covers both the intra-label case (`*-acmeinc.vercel.app`) and the whole-label
case (`*.acme-app.pages.dev`). Today matching is exact string equality
(`internal/api/flow.go:371`), so a matcher is net-new work either way.

### The RP ID consequence

`passkeyRPFromOrigin` (`internal/api/flow.go:397-403`) derives the WebAuthn
relying-party id as `origin.Hostname()` — the full host, port dropped. A
credential is only assertable under the RP ID it was registered with, so today:

- A passkey registered at `app.acme.com` has RP ID `app.acme.com`.
- A preview at `acme-git-foo-acmeinc.vercel.app` gets RP ID
  `acme-git-foo-acmeinc.vercel.app`.
- The browser will not offer the first credential to the second RP ID. Not a
  server decision — it is enforced in the client.

So a shared-host preview against a production project can exercise password,
one-time-code and social sign-in with real users, and **cannot** exercise passkey
assertion. Allowing the origin does not change that, and no server-side setting
can.

Own-domain previews *can* be made to work, but only with a change this note
should name rather than assume: **the RP ID has to become a project setting —
the registrable domain, `acme.com` — validated as a suffix of every `primary`
origin, instead of being derived per request.** Then `app.acme.com` and
`foo.preview.acme.com` both legitimately claim RP ID `acme.com` and credentials
are portable between them. That change also retires the loopback-spelling
complaint the current code comments about (`internal/api/flow.go:375-385`).

Shared hosts can never join that arrangement: `vercel.app` is on the Public
Suffix List, so no tenant may claim it as an RP ID, and `acme.com` is not a
suffix of `…vercel.app`. The capability split is therefore permanent:

| Preview origin | May pin a release | Passkey with production credentials |
|---|---|---|
| Own domain, `*.preview.acme.com` | Yes, required | **Yes** — once RP ID is a project setting |
| Shared host, `*-acmeinc.vercel.app` | Yes, required | **No** — impossible by Public Suffix List |

The practical advice that falls out: allow the shared-host wildcard for
convenience, and put previews that must test the full sign-in surface on your
own domain. Most platforms can alias a preview deployment onto a custom domain,
which is the thing to reach for.

### The default shape for a team

Previews may live on the production project, so the project count is a choice
rather than a consequence:

| Shape | Projects | Trade |
|---|---|---|
| Two | dev (`sandbox`), production (`production`, with `preview` origins) | Fewest moving parts. Previews see real users and real variables, and cannot do passkey unless on your own domain. |
| Three | dev, preview, production (all previews on the `sandbox` preview project) | Previews are isolated from real users, get their own IdP clients, and can register their own passkeys. Costs a project and a set of variables. |

Both are supported; neither is seeded. That is the difference from environments,
where the set and its names were decided for the developer at project creation.

### Transitions

- **`sandbox` → `production`** revalidates every stored origin against the
  `production` column — including the tenant-anchor rule for every `preview`
  entry on a shared host — and fails, naming each offender, if any violates it.
  Requires a claimed project: an unclaimed project has no accountable owner and
  should not be serving real users.
- **`production` → `sandbox`** is a downgrade that re-admits loopback origins to
  a project holding real users. It requires explicit confirmation from the claim
  holder and is audited. Not forbidden — a project can be retired — but never
  incidental.

### What this is not

The class is not environment #1 under a new name: there is **one** flag per
project, it holds no release pointer, has no name of its own, no set to belong
to, no deployment history, and no lifecycle beyond the two transitions above.
Nothing resolves *to* it. It constrains what a project may accept; it never
selects what a request is served.

The origin kind is not one either, for the same reason: `preview` is an
adjective on an allowlist entry, not a slot with a release in it.

## Release identity on the wire

The existing `ContentHash` becomes the public name of a release.

```
sha256:4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394
```

Short forms accepted down to 12 hex characters, resolved against the project's
releases, ambiguity refused — the git convention. The hash is already unique per
project, so nothing new is needed to enforce that.

Why this matters beyond aesthetics: a content hash is reproducible. The same
`.zitadel/` content posted to two different projects yields the same hash in
both, over different underlying revision ids — because the hash covers
`(kind, handle, revision_id)`… which is precisely where it does **not** hold.
Revision ids are per-project ULIDs, so the same content in two projects produces
**different** hashes today.

That is a real obstacle to the reproducibility argument, and it has a cheap fix:
**hash the content, not the pointers.** A second hash, `rel-v2`, computed over
the canonical bytes of each pinned resource rather than its revision id, is
project-independent by construction. `ContentHash` as it stands is an
*identity* hash (what does this release pin); the new one is an *equivalence*
hash (what does this release mean). Both are cheap to compute at construction.

> **Decision needed.** Expose the existing pointer hash and give up
> cross-project reproducibility, or add a content-equivalence hash and get it.
> The second is what makes [promotion](#what-promotion-becomes) checkable, and
> it is the single most consequential open item in this note.

## The release resolver

The trust assumptions have to come before the rules, because the intuitive
reading of them is wrong.

### What each input actually proves

| Input | Where it comes from today | What it proves |
|---|---|---|
| `project_id` | A **body field** on `POST /flow` — `create-flow-request.yaml:2`, `required: [project_id, purpose]`. The operation is `security: []`. | **Nothing.** An unauthenticated assertion. ADR 036 is already replacing it with the publishable key for exactly this reason. |
| `Origin` | Header, or reconstructed from `X-Forwarded-Proto`/`X-Forwarded-Host` by `WithRequestHostMiddleware` (`internal/api/security.go:176-197`). | That a **browser** is on an allowlisted page. **Nothing** against a non-browser client: `curl` sets any `Origin` it likes, and the forwarded-header fallback is caller-controlled too. |
| publishable key | `configureZitadel({ publishableKey })`. Exists in the domain as `TokenTypeProjectPreview`, read-only (`project.read`), barred from management APIs. | The project, server-side, plus an origin constraint *if* the caller is a browser. Public-safe by construction — an identifier with a constraint, not a secret. |
| project secret | `.zitadel/secret` or a platform secret store. `TokenTypeProjectToken`; the only credential satisfying `HandleOAuth2` with management authority. | The calling software, with full project authority. **The only input here that withstands a non-browser attacker.** |
| release hash | Build-time constant in the caller. | Nothing by itself. Validated against the project's releases. |

The honest summary: **origin checks protect browser users from a malicious page;
they do not protect the server from a malicious client.** Only the project
secret does that. Any rule that treats an allowlisted `Origin` as authorization
for a privileged operation is mistaken about what the header is.

### The honest state of origins

Worth stating because the proposal leans on origins more than the code
currently supports:

- There is **one** enforcement call site: `validateOriginAgainstProject`
  (`internal/api/flow.go:371`), reached only from `SubmitFlowStep`, and only
  when a WebAuthn RP ID can be derived from the origin.
- Matching is **exact string equality**. There is no wildcard matching — so the
  `*.vercel.app`-shaped entries the setup CLI writes into `preview_origins`
  **never match anything**.
- An **empty allowlist means allow-all** (`internal/api/flow.go:373`).
- Failure returns a generic 400 `ErrRequestInvalid`, not the
  `origin_not_allowed` code `security-and-origins.md` specifies.
- There is **no CORS middleware anywhere** in the server. No
  `Access-Control-Allow-Origin` is ever set.

So the origin allowlist specified in `security-and-origins.md` is a design, not
a mechanism. This proposal does not create that gap, but it does make closing it
a prerequisite rather than a nicety: a resolver that lets a caller pick a release
needs the allowlist to actually work.

### Rules

**Project first.** Resolve the project from the credential where one exists —
publishable key or project secret. A body `project_id` that disagrees is `403`.
Where no credential exists (today's `security: []` flow path) the body field
stands, and that is the path ADR 036 is closing.

**Then the release, in three layers**
([why three](#what-this-does-to-resolution)):

1. **Gate.** `Origin` present and matching no `allowed_origins` pattern → `403`.
   `Origin` absent falls straight through; there is nothing to check.
2. **Route.** An origin row for this exact `Origin` → serve the release its
   `current_deployment_id` points at. The caller sent nothing and needed to know
   nothing. This answers almost all browser traffic.
3. **Fall back.** No origin row. An explicit `X-Zitadel-Release` wins if present
   and permitted; otherwise the project's `current_deployment_id`.

**Who may use layer 3's header.** This is the only place the class still
matters. On a `production` project the header requires the publishable key or
the project secret, so an anonymous pin is `403`. On a `sandbox` project it is
open, because local development leans on it and the project holds no real users.
A `preview`-kind pattern that was matched by layer 1 but produced no layer 2 row
is a deploy that did not register its origin: serve the fallback and say so in
the response, rather than guessing.

**Then, regardless of which layer answered**

4. **The resolved release is sealed into the flow state.** This follows an
   existing precedent rather than inventing one: `FlowState` already seals
   `UserSchemaURL` at start time "so a mid-flow default change doesn't reshape
   in-flight data" (`internal/domain/flow_state.go:21-24`), and already carries
   `SessionVersion` / `StepVersion` integrity counters. A sealed release is the
   same idea one level up, and it matters more now: layer 2 means a deploy can
   move an origin's release *while* a user is signing in. This is the one piece
   of [#536](https://github.com/zitadel/nextgen/issues/536) that survives intact.
5. **A hash from another project is `404`,** matching the project-boundary
   convention the rest of the API follows.
6. **A revoked release is `409`.** Revoking a release any origin row currently
   serves is refused — move that origin first.
7. **A project always has a current release.** One is built from
   `packages/config/defaults` at project creation — replacing `SeedDefaults`'
   call site in the project-create transaction — so layer 3 never has to answer
   "nothing is deployed".

**Where the hash rides, when it rides at all.** `X-Zitadel-Release`, a request
header, as the closed prototype
[#1258](https://github.com/zitadel/nextgen/pull/1258) had it — a header rather
than a body field because resolution must work on endpoints with no body. With
layer 2 in place this is no longer the primary path: it is for callers with no
`Origin` to route on, which in practice means server-side apps and CI.

Note on the seam: the project id arrives in the **body** of `POST /flow`, so a
`net/http` middleware cannot read it without buffering. The ogen middleware chain
(`cmd/server/server.go:395-397`, alongside `AddOperationIdToContext`) is the only
seam with the decoded request in hand, and is where resolution belongs. Also
note the path is `/flow`, singular — #536's text says `/flows`.

### The uncomfortable part, and how much of it is left

On the client-carried-hash path, for a browser SPA that cannot hold a secret,
**the release hash is a capability: knowing it is what authorizes serving it.**
The publishable key names the project and constrains the origin, but neither
stops a non-browser client holding both values — and the key is public by
construction while the hash ships in the bundle.

Two things shrink this to almost nothing, and it is worth being precise about
what remains:

- **The [origin inventory](#origins-the-allowlist-and-the-inventory) removes the
  path.** When layer 2 answers, no hash is sent, so there is no capability to
  hold. Every browser caller whose deploy registered an origin is simply out of
  scope for this concern.
- **The [project class](#project-class-and-origin-kinds) gates the remainder.**
  On a `production` project the fallback header needs a credential, so an
  anonymous pin is refused outright.

What is left is `sandbox` projects using the fallback header — local development,
and previews on platforms with no registration step. There the hash is still a
capability, and these still apply:

- **The hash is hard to guess.** The pointer hash covers ULID revision ids, so
  release enumeration is infeasible. A content-equivalence hash would be weaker
  here — but see [Open 1](#open): with layer 2 carrying production traffic, that
  weakness no longer blocks the reproducible hash.
- **`GET /releases` stays on the operator plane.** A listing that leaked hashes
  would undo the previous point.
- **Revocation is the containment tool.** The real risk of arbitrary pinning is a
  downgrade: someone serves an old release whose policy you have since
  tightened. Revocation withdraws it from service without relying on nobody
  still holding its hash.
- **Callers needing a real guarantee route through their own server.** The
  scaffolds already proxy `/__nextgen`; flow traffic behind that proxy with the
  project secret is on the app plane and gets authorization rather than
  capability. A recommendation, not an enforcement.

The alternative — a short-lived server-signed token minted at bootstrap that
encodes the release, which is what the specced-but-unshipped
`POST /bootstrap/challenge` would be for — does **not** fix this, because the
same forged `Origin` gets the token minted. There is no browser-only control
that survives a non-browser attacker. Saying so beats building ceremony that
implies otherwise.

### Errors

| Condition | Status | Code |
|---|---|---|
| `Origin` present, matching no allowlist entry | 403 | `proj.origin_not_allowed` |
| Body `project_id` disagrees with the credential | 403 | `proj.mismatch` |
| Hash names a release of another project, or none | 404 | `rel.not_found` |
| Short hash matches more than one release | 400 | `rel.ambiguous` |
| Release revoked | 409 | `rel.revoked` |
| Uncredentialled caller named a hash on a `production` project | 403 | `rel.pin_not_permitted` |
| `preview` pattern matched, no origin row and no permitted header | 400 | `rel.required` |
| Revoking a release an origin row currently serves | 409 | `rel.in_service` |
| Loopback origin, or a wildcard `primary` entry, saved on a `production` project | 400 | `proj.origin_not_permitted_for_class` |
| Shared-host wildcard that is not tenant-anchored, on a `production` project | 400 | `proj.origin_not_tenant_anchored` |
| Shared-host wildcard on a host the registry does not know | 400 | `proj.origin_host_unknown` |
| Passkey ceremony attempted from an origin whose RP ID cannot match the project's | 400 | `flow.passkey_rp_unavailable` |
| `sandbox` → `production` while a stored origin violates the class | 400 | `proj.class_transition_blocked` |

### The two shapes the ask named

**An SPA that cannot hold a secret.** It holds a publishable key and a release
hash, both public, and the browser contributes the `Origin` it cannot forge. No
new credential class is needed: ADR 036's publishable key — already in the
domain as `TokenTypeProjectPreview` — is exactly this. What is new is that the
key must become acceptable on the flow operations, which today take no
credential at all.

**A server-side app that sends no `Origin`.** It holds the project secret, a
strictly stronger claim than an origin, and the credential carries the project.
Origin checks are **skipped** for this class rather than faked. Note that
[secret.md](secret.md#validation-and-revocation) today contemplates falling back
to `Host` "where the runtime cannot send `Origin`"; that fallback should be
dropped — the secret alone suffices and `Host` was never attesting anything.

The symmetry: **one of origin or secret must be present, and either alone is
enough to be served.** Neither present means the current release and nothing
else.

## What promotion becomes

ADR 035's promise is that "the exact artifact that was tried is the one that
moves on", enforced by deploying one release id to several environments. With
environments gone and stages as separate projects, a release id cannot cross a
project boundary — its pointers name revisions that exist in one project only.

Hash equality replaces artifact identity: CI posts the same content to the
staging project and then the production project, and asserts the two hashes
match. **This only works with a content-equivalence hash** — with the existing
pointer hash the two will differ by construction. The guarantee becomes
*verifiable* rather than *structural*: weaker in the registry sense, stronger in
the reproducibility sense.

`zitadel promote` therefore has no server surface left. It either disappears or
becomes sugar for "deploy this commit against the other target and assert the
hash is unchanged".

> **The sharpest trade in the design.** Accepting it means promotion is a
> client-side assertion. The alternative is portable releases — a construction
> endpoint accepting full bundle content and materialising revisions in the
> target project — which restores a registry-like push/pull at the cost of a
> second construction path.

## Many developers, one shared server

Five developers each run the frontend on `http://localhost:3000`, all pointing at
one shared `sandbox` project on a shared server. Each has their own uncommitted
`.zitadel/` edits. This is the ordinary case, and it is the case the environment
model handled worst — it needs an environment per developer, with naming,
expiry and collection, which is most of what
[#1311](https://github.com/zitadel/nextgen/issues/1311) was for.

The origin cannot separate them: all five send the same `Origin`. The release
hash can, because it travels on the request rather than being a property of where
the request came from.

### The mechanism

1. A developer edits `.zitadel/flows/login.json`.
2. The dev-server hook **builds a release and does not activate it** — a
   `POST /releases`-shaped call returning a hash. Content-hash dedup means
   identical content across two developers reuses one row rather than creating a
   second.
3. The hash lands in the local runtime document. This does not need inventing:
   `.zitadel/local/runtime.json` already exists, and
   `standaloneRuntimeResolver` (`cmd/server/console_runtime.go:53-56`) already
   serves a runtime document carrying the default project id and the publishable
   key to console and login. The current hash joins that document.
4. The browser sends it as `X-Zitadel-Release` on flow calls.
5. The shared project's current release is **never touched**. Each developer sees
   their own configuration; none of them can disturb the other four.

### The invariant this establishes

> **In the inner loop, nobody activates.** Building a release is a save;
> activating one is a deploy. Only CI, or an explicit `zitadel deploy`, moves a
> project's current release.

ADR 035 left "inner-loop semantics" explicitly open — "whether every local save
creates a release (Vercel-shaped local dev) or only explicit `zitadel deploy`
does (Terraform-shaped)". This answers it, and the answer is neither of the two
offered: **every save creates a release, no save activates one.** That split is
only available once a release can be served without being the project's current
one, which is exactly what this design adds.

It also generalises ADR 035's existing promise. There, "revisions drafted
outside a release are inert". Here, one level up: *releases that were never
activated are inert to everyone except a caller that names them.*

### Why the hash must come from a runtime document in dev, not the build

A build-time constant is right for a deployed app and wrong for the inner loop: a
developer editing `.zitadel/` expects the next page load to reflect it, not the
next rebuild. In development the hash is read per request from the local runtime
document; in a deployed app it is baked in as `NEXT_PUBLIC_ZITADEL_RELEASE` and
friends. Same header on the wire, two sources.

This is also the honest reason the hash is a header and not something negotiated
once per session: in dev it changes on roughly every file save.

### What it costs

A release row per distinct local content state, per developer, on a shared
project. Content-hash dedup bounds this by distinct content rather than by number
of saves, but it is still a lot of rows, and they are all never-activated.

So **release collection replaces environment collection.** We delete the preview
environment garbage collector and acquire a release one. That trade is worth
stating plainly rather than presenting the deletion as free — but the new
collector is much simpler than the one it replaces: a release that has never
been activated, has not been resolved recently, and is older than some retention
window is collectable. No names to reuse, no origins to orphan, no expiry to
renew, no idempotent-create-renews-TTL semantics. Just unreferenced and cold.

An activated release is never collected while it is in any project's deployment
history, which is what makes rollback meaningful.

### The other variation: different projects, same localhost

The developers need not belong to the same project. Dev A works on project A,
dev B on project B, both on `http://localhost:3000`, both against the same
shared server. Three observations, in increasing order of how much they matter.

**Project resolution is unambiguous, by construction.** The project comes from
the credential, or failing that from the request, and **never from the origin**.
So the fact that `http://localhost:3000` appears in two projects' allowlists
creates no ambiguity. This is worth stating because the environment design had
to resolve the environment *from* the origin, where the same situation is a
genuine collision — it is the case
[#1311](https://github.com/zitadel/nextgen/issues/1311) answered with "a
wildcard-reached request must carry `X-Zitadel-Environment`". Here there is
nothing to disambiguate.

**A loopback entry in an allowlist is a formality, not an authorization.**
`http://localhost:3000` is allowlisted by every project that allows local
development, so matching it proves nothing about which project the caller is
entitled to. That is not a flaw to fix — it is the reason loopback is confined
to `sandbox` projects, where nothing is being protected. A design that treats
"the origin is in the allowlist" as meaningful for loopback is fooling itself.

**The one real collision is WebAuthn, and it bites.** RP ID is
`origin.Hostname()` with the port dropped (`internal/api/flow.go:397-403`), so
project A on `localhost:3000` and project B on `localhost:3001` both get RP ID
`localhost`. Distinct ports do **not** separate them. A developer's browser
accumulates one `localhost` credential list spanning every project they work on;
a discoverable-credential (usernameless) ceremony offers all of them, the server
rejects the ones belonging to another project, and the developer sees a
confusing failure rather than a clear one.

The fix is a hostname per project, not a port per project, and it is cheap:
`*.localhost` resolves to loopback in current browsers and counts as a
trustworthy origin for secure-context purposes, so `project-a.localhost` and
`project-b.localhost` give distinct RP IDs with no TLS and no `/etc/hosts`
editing. **The CLI should scaffold a per-project local hostname rather than a
bare port**, and `setup` is the place that decision gets made. This is a small
change with a disproportionate effect on how local development feels, and it is
needed whether or not the rest of this note is adopted.

### What this does not solve

Developers sharing a project share its users, sessions and variables. A developer
who deletes a test user deletes it for everyone. That is the same trade
[#1308](https://github.com/zitadel/nextgen/pull/1308) already accepted between
environments, and the escape hatch is the same as everywhere else here: a
developer who needs isolation uses their own project, which costs them a
`ZITADEL_PROJECT_ID` in `.env.local` and nothing else. The
different-projects-same-localhost case above is that escape hatch already being
taken.

## Variables

ADR 062 scopes a variable to `(project_id, environment_id)`, with the primary
key `(name, project_id, environment_id)` and `environment_id = ''` already
meaning the project. Dropping environments means: drop the column, drop the
`environment_ref` generated column and its composite FK, drop the
`environment_name` query parameter from the four operations. The `${{ NAME }}`
format, the five rendering cases, the owner-exact read predicate
(`internal/storage/variable/query.go:20-33`) and the no-inheritance rule are all
untouched. **This is the cheapest part of the proposal** — the surviving
behaviour is already the default path.

Per-stage credential separation does not disappear with the scope level, because
a stage is a separate project: the staging project holds the staging Google
client id, the production project holds the production one. The case ADR 062 was
written for is served by projects rather than by a scope level.

What is genuinely lost: a preview on the production project — now permitted, see
[preview origins](#preview-origins-on-a-production-project) — shares that
project's variables, so it cannot point at a different IdP client than production
does. That is often exactly what you want from a preview, and when it is not, the
preview moves to a `sandbox` project with its own variables. A client-side
choice, which is the whole thesis.

## The CLI side: target resolution

### What exists

**Server URL** — `resolveServer` (`apps/cli/src/lib/server.ts:43-58`), already a
precedence chain: `--server` → `ZITADEL_API_BASE` → top-level `server` in
`zitadel.json` → `https://api.zitadel.cloud`. Plus the literal `local`.

**Project id** — one source, no chain: `.zitadel/secret` → `project_id`
(`apps/cli/src/lib/project.ts:84-108`). There is no `--project` flag, and
`ZITADEL_PROJECT_ID` is never read by the CLI — only written into the generated
app's `.env.local`.

**Dotenv** — no library; Node's `parseEnv`. Exactly `.env.local` then `.env`,
root-relative, no `.env.<stage>` of any spelling. Only `NEXTGEN_*` values are
forwarded anywhere. No `.env` file feeds `resolveServer` or the project id.

**Credential** — always `project_secret` from `.zitadel/secret`. No env var
supplies it.

### Why that blocks this design

`.zitadel/secret` binds the project id and the project secret into one
gitignored file, so **one repository can address exactly one project.** If a
stage is a project, that is the single blocking constraint.

### What changes

`.zitadel/secret` becomes the *default* target, not the only one. Each value
resolves independently, highest priority first:

1. Explicit flag — `--server`, `--project`
2. `process.env` — so a platform's environment store and CI always beat disk
3. `.env.<stage>.local`
4. `.env.local` — skipped when the stage is `test`
5. `.env.<stage>`
6. `.env`
7. `zitadel.json`, for public-safe values only (server, project id, publishable
   key — never the secret)
8. `.zitadel/secret`, for project id and secret
9. Interactive prompt, TTY only, persisted to `.env.<stage>.local`
10. Error naming the stage resolved, the value missing, and every file consulted

Steps 3–6 are the Next.js precedence developers already hold in their heads,
which is the reason to adopt it rather than invent one. Steps 7–8 keep today's
behaviour as the tail, so nothing that works now stops working.

**Stage detection**, highest priority first — a purely local label selecting
which `.env.<stage>` files to read, never sent to the server:
`--env` → `ZITADEL_ENV` → platform signals already catalogued in
[configuration surface § environment detection](configuration-surface.md#environment-detection)
(`VERCEL_ENV`, `NETLIFY_CONTEXT`, `RAILWAY_ENVIRONMENT`, …) → `NODE_ENV` →
`development`.

### Variable names

| Variable | Status |
|---|---|
| `ZITADEL_API_BASE` | Exists, CLI-only |
| `ZITADEL_URL` | Exists, written to `.env.local`, read by generated apps |
| `ZITADEL_PROJECT_ID` | Written today, read by nobody in the CLI — becomes a real input |
| `ZITADEL_PROJECT_SECRET` | Exists |
| `ZITADEL_RELEASE` | **New** — set by the build, read by the server-side SDK |
| `NEXT_PUBLIC_ZITADEL_RELEASE` / `VITE_…` / `NUXT_PUBLIC_…` | **New** — browser bundle |
| `ZITADEL_ENVIRONMENT` | **Deleted.** Written as the hard-coded literal `"development"`; read only by a renderer marked `not-implemented` and by an `sdk-core` resolver no scaffold wires. Removing it costs nothing. |

`ZITADEL_API_BASE` and `ZITADEL_URL` are two names for the same thing on
opposite sides of the same `.env.local`. Collapsing them (keeping the other as a
deprecated alias) is a small cleanup this design makes more visible, not one it
depends on.

### Two rules that matter more than they look

- **Dotenv never overrides the real process environment.** A platform injecting
  `ZITADEL_PROJECT_ID` must beat a committed `.env`, or a preview deploy
  silently talks to the wrong project. Hence `process.env` at step 2, not 7.
- **Resolution is explainable.** `zitadel env` prints each value, its source, and
  the files consulted in order. "Which `.env` did it pick" is the question this
  design will generate most often.

## SDK changes

**All of these become optional** once origins route: a browser caller answered by
layer 2 sends nothing new. They are what the fallback path needs, and what a
server-side app needs, not what every client needs.

- `ZitadelConfig` (`packages/api/src/runtime/config.ts`) gains
  `release?: string` beside `projectId` and `publishableKey`.
- `packages/api/src/runtime/fetch.ts` sends `X-Zitadel-Release` when configured.
  It sets only `authorization` today, so this is the first `X-Zitadel-*` header
  in the client.
- Scaffolds inject `NEXT_PUBLIC_ZITADEL_RELEASE` and the Vite/Nuxt equivalents
  at build time, from `ZITADEL_RELEASE` in the build environment — what
  `zitadel deploy` prints.
- `resolveZitadelRuntimeEnv` (`packages/sdk-core/src/index.ts:41-49`) drops
  `environment` and gains `release`; `ZitadelEnvironment` goes with it.
- `standaloneRuntimeResolver` (`cmd/server/console_runtime.go:53-56`), which
  already serves a default project id plus publishable key to console and login,
  is the natural place for the current release hash to join that document.

## What this costs

- **ADR 035 is amended substantially.** Environments and deployments as
  specified do not survive; releases do, nearly intact.
- **ADR 062's scope section is amended** to drop the environment level.
- **ADR 036 is simplified:** "keys are issued per environment" becomes "per
  project", and allow-all origin lists are gated by
  [project class](#project-class-and-origin-kinds) rather than environment class.
- **Two concepts are added to the project** — `class` (two values) and a `kind`
  on each origin entry (`primary` / `preview`), plus the save-time validation and
  the two transitions they imply. They pay for themselves: the class makes
  release pinning on a production project an authorized operation rather than a
  capability one, and the kind is what lets one project be production *and* host
  previews.
- **An origin inventory is new** — a row per exact live origin, carrying
  `current_deployment_id` and an optional `expires_at`, plus a collector for
  expired rows. This is the environment row with its name deleted, and the
  [honest accounting](#the-honest-accounting) says so plainly: the entity is
  reshaped, not removed. What it buys is previews that need no client changes,
  and the removal of the naming layer that made #1311 expensive.
- **An origin matcher and a preview-host registry are new.** Matching is exact
  string equality today, so wildcards do not work at all — the `*.vercel.app`
  entries the setup CLI writes into `preview_origins` match nothing. The matcher
  is needed regardless; the registry recording where each host's tenant-unique
  label sits is specific to allowing shared-host previews on production, and is
  the price of the ask.
- **The SDK and scaffold changes become optional.** With origins routing, a
  browser caller sends nothing new; `X-Zitadel-Release` and the
  `NEXT_PUBLIC_ZITADEL_RELEASE` family are for the fallback path and server-side
  apps only.
- **RP ID has to become a project setting** for own-domain previews to use
  production passkeys, instead of being derived per request from the full
  hostname. Adjacent work, not strictly part of this design, but previews on a
  production project are half-useful without it.
- **The CLI should scaffold a per-project `*.localhost` hostname** instead of a
  bare port, so that developers working on different projects do not share one
  WebAuthn RP ID. Small, independent, and worth doing either way.
- **Release collection replaces environment collection.** The preview-environment
  garbage collector goes; a simpler never-activated-and-cold release collector
  arrives. Not free, but a smaller mechanism than the one removed.
- **[#1311](https://github.com/zitadel/nextgen/issues/1311) is dropped** rather
  than implemented, and [#1308](https://github.com/zitadel/nextgen/pull/1308)'s
  lifecycle half with it. #1308's data-isolation half survives and is
  strengthened: isolation means a separate project, which is what it decided.
- **[#536](https://github.com/zitadel/nextgen/issues/536) shrinks** to release
  resolution plus sealing the hash into flow state.
- **Origin enforcement becomes a prerequisite.** Today it is one call site, exact
  string matching, allow-all on empty, no CORS. That has to be real before a
  resolver can lean on it.
- **Promotion weakens** from artifact identity to hash equality, and only works
  at all with a content-equivalence hash.
- **A preview shares its project's data and variables.** Already true under
  #1308; worth restating because it is what a developer will be surprised by.
- **Arbitrary release pinning by a browser caller rests on hash
  unguessability** — but only on `sandbox` projects, which is the point of the
  class.

## Open

1. **Pointer hash or content-equivalence hash on the wire — now leaning
   content.** This was the hinge while the client carried the hash on every
   request: the pointer hash's unguessability was load-bearing, and a
   reproducible content hash is guessable by anyone who can guess the
   configuration. The [origin inventory](#origins-the-allowlist-and-the-inventory)
   takes the hash off the hot path, so unguessability stops being load-bearing
   and the content-equivalence hash becomes affordable — which makes
   [promotion by digest equality](#what-promotion-becomes) checkable. What still
   needs deciding is whether `sandbox` projects using the fallback header are
   enough of a case to keep both hashes.
2. **Portable releases or not** — the promotion trade. If releases become
   portable, stages could share a project again and the design gains an escape
   hatch it otherwise lacks.
3. **Whether `current_deployment_id` belongs on the project row** or is derived
   from the newest deployment. The column is what exists; the index for the
   query exists too.
4. **Whether a `production` project's pin rule can be enforced before ADR 036
   lands.** The rule needs a credential on the flow operations, which today take
   none. Either this design waits on ADR 036's publishable-key work, or
   `production`-class projects refuse pinning outright until it does — which is
   safe but, now that previews are allowed on production projects, costs exactly
   the feature this was extended to support. The publishable key is on the
   critical path.
5. **Release retention window and what counts as "resolved recently".** The
   collector needs a last-resolved timestamp on the release, which is a write on
   the hot path — or an approximation that avoids one. Whether a
   never-activated release is collectable after days or weeks is a product
   decision; whether it is tracked precisely is an engineering one.
6. **Whether the class is two values or whether rate limiting wants a third.**
   This note collapses `security-and-origins.md`'s three to two on the grounds
   that `development` and `preview` have identical origin rules. If rate limits
   end up wanting to key on the same flag rather than its own, the third value
   comes back.
7. **Whether `class` should gate anything else already claim-gated.** Real
   email/SMS is gated on claim today. Two near-parallel axes — claimed, and
   `production` — risk drifting. Worth deciding whether `production` requires
   claim (this note says yes) and whether anything else should move onto the
   class.
8. **Who maintains the preview-host registry, and what happens when a host
   changes its URL shape.** Vercel, Netlify and Cloudflare have each changed
   preview hostname formats before. A stale registry entry either rejects
   legitimate patterns or, worse, accepts one that is no longer tenant-anchored.
   Options: ship it as data rather than code so it can be corrected without a
   release; or refuse shared-host wildcards on `production` and require
   exact-URL registration at deploy, which needs no registry at all.
9. **Exact-URL registration as the better long-term answer.**
   `security-and-origins.md` already names it: CI injects the exact preview URL
   at deploy and removes it at teardown. It needs no wildcards, no registry and
   no tenant-anchor rule, and the build step that injects the release hash is
   already the natural place to do it. The cost is origin entries that need a
   TTL and a collector — which is `expires_at` reappearing, one level down from
   the environments it was deleted from. Worth comparing properly against the
   wildcard path rather than treating wildcards as the destination.
10. **Whether a `preview`-kind origin should be allowed to serve a release that
   is not in the project's deployment history at all.** Requiring the hash stops
   a stranger being served, but it does not stop a developer pinning a release
   that was never reviewed. For a production project that may be too permissive;
   restricting previews to releases activated on *some* project, or to releases
   created in the last N days, are both cheap narrowings.
