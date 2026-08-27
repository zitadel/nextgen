# ADR 057: User Identity Designation and References

> **Status:** Proposed
> **Date:** 2026-08-24
> **Context:** user schemas, every API surface that links a user (sessions,
> events, auth attempts, future grants and memberships), auth-attempt
> identifier resolution, console and login UI user rendering
>
> Solution design for [#956](https://github.com/zitadel/nextgen/issues/956)
> (hard-coded user attributes on UI and API); reframes
> [#869](https://github.com/zitadel/nextgen/issues/869) (session list identity).
>
> **Amends** [ADR 052](052-user-envelope-and-attributes.md) and extends
> [ADR 008](008-users-eav-store.md) — uniqueness gains normalized value
> comparison (§4a); the user
> envelope gains derived, read-only identity fields (`identifier`,
> `identifier_property`, `display`, §3a). Builds on
> [ADR 048](048-wide-events-internal-audit-primitive.md) (audit events).

## Decision

User schemas declare which attributes identify and label a user. The platform
resolves those declarations into one shared wire shape — the **user ref** —
wherever a resource links a user. No fixed property names anywhere.

### 1. `x-identifier` — the designated identifier

A schema-root keyword naming one leaf property:

```json
{
  "kind": "user-schema",
  "x-identifier": "email",
  "properties": {
    "email": { "type": "string", "format": "email", "x-unique": "project" }
  }
}
```

One identifier, not a set: every consumer with teeth — refs, the envelope,
display fallback, direct-API resolution — uses exactly one value, and the
only feature multiple designations would serve ("log in with email *or*
username") does not exist in the product today. Designating a set would buy
that absent feature at the price of cross-property collision rules and an
OR-across-properties lookup the storage layer does not have. If
multi-property login arrives, the keyword widens from a string to an ordered
array the way JSON Schema's own `type` does — an idiomatic union, amending
this ADR without breaking it.

Validation (at schema create/update):

- The named property must exist and be a **leaf** (a scalar value, not an
  object). Nested leaves qualify, addressed by their attribute path:
  attributes are stored flattened into path-keyed rows, so a nested leaf is
  as individually unique and as individually resolvable as a top-level one.
  (Flow steps can only *offer* an identifier their field addressing reaches —
  top-level names today — but that limits flows, not designation.)
- The property must be unique over the scope the platform resolves
  identifiers in. Every resolution context today — auth attempts, refs, list
  surfaces — is the project, so `x-unique: "project"` is required for now.
  Team-scoped uniqueness is deliberate narrower semantics, not a defect: a
  team-unique username anticipates login restricted to that team, and such a
  value is intentionally unresolvable in a project-wide context. Once a
  team-qualified resolution context exists (per-team login domains, a team
  discovery step, a team-scoped auth attempt), `x-unique: "team"` properties
  become admissible here; that relaxation amends this ADR without breaking
  it.
- **Conditional requirement:** a schema that enables an auth method needing
  identifier-first dispatch — today `x-auth-methods.password.enabled: true` —
  must designate an identifier. Password verification is unreachable without
  a prior identifier (the state machine dispatches identifier before
  password), so the absence is a schema error, not a runtime surprise.
  Passkey-only and API-managed schemas may designate none: discoverable
  credentials identify the user through the assertion itself, so no typed
  identifier exists in a usernameless flow, and a universal requirement
  would outlaw that design. A flow that picks the identifier-first passkey
  pattern instead is enforced at the flow level, where the on_success
  manifest requires the identifier to be collected upstream — the schema
  rule covers only methods that can never work identifier-free (magic link
  and OTP join password there when they arrive).

### 2. `x-display` — the display designation

A schema-root keyword: an ordered list of property paths — leaf properties,
nested ones addressed by their attribute path as in §1 — whose values,
joined with a space, render the user's friendly display name.

```json
{ "x-display": ["givenName", "surname"] }
```

No uniqueness requirement. Optional; a
schema without it simply has no display name and falls back to the identifier.
This replaces the invisible convention (`name`, `givenName`/`given_name` +
`familyName`/`family_name`) that today decides whether a UI shows a name or a
raw ULID.

### 3. The `user-ref` wire component

Every resource that links a user embeds one shared shape instead of inventing
fields:

```json
{
  "user_id": "user_01KZZY8PX8K8ATNVDSMRCZY4N1",
  "identifier": "alex@acme.com",
  "identifier_property": "email",
  "display": "Alex Chen"
}
```

- `user_id` is always present (the envelope ID, [ADR 052](052-user-envelope-and-attributes.md)).
- `identifier` is the current value of the designated identifier. Absent when
  the user is deleted, the schema designates nothing, or the user lacks the
  value.
- `identifier_property` names the schema property `identifier` came from, so
  a client that wants semantics (mailto links, formatting, a field label) can
  reach the property's schema instead of guessing from the value. Present
  exactly when `identifier` is.
- `display` is the `x-display` rendering. Absent under the same conditions.
  No source attribution — it is a rendering of several properties and purely
  presentational.
- Clients render `display` → `identifier` → `user_id`, uniformly everywhere.

The fields are role-named, not property-named, on purpose: a list can mix
users from different schemas, and property-named keys would force every
client to consult each row's schema designation to find "the" identifier.
The roles are declared by the schema author through the keywords — the
platform transports the declaration's result, it interprets nothing.

### 3a. The user resource carries its own resolution

A user list or detail response does not embed a ref to itself, but it answers
the same label question the same way: the envelope
([ADR 052](052-user-envelope-and-attributes.md), extended here) gains the
derived, read-only fields `identifier`, `identifier_property`, and `display`,
produced by the same resolution service under the same fallback chain —
`user_id` is omitted since the envelope already has `id`.

```json
{
  "id": "user_01KZZY8PX8K8ATNVDSMRCZY4N1",
  "schema": "sch_01KZZY705G04CPPG0QGZM9ERF2",
  "identifier": "alex@acme.com",
  "identifier_property": "email",
  "display": "Alex Chen",
  "attributes": { "email": "alex@acme.com", "givenName": "Alex" },
  "metadata": { "created_at": "2026-08-14T10:49:43Z", "status": "active" }
}
```

`attributes` remains the schema-validated document; the envelope fields are
the platform's derived rendering of it. The duplication is deliberate — it
lets clients render user rows with zero designation logic, and lets list
responses hydrate only the designated attribute keys (or eventually none)
while rows still render.

Values are resolved **live** at read time. All refs for the same user carry
the same label in the same response — a user's five sessions and their grants
all read identically, regardless of how each session was authenticated.

### 4. Batch resolution

A single resolution port hydrates refs: `(project_id, user_ids) → refs`, one
batched attribute query per page. List endpoints must not resolve per row.
Missing users are simply absent from the result — their refs degrade to
`user_id`, and the rest of the page is unaffected.

### 4a. Uniqueness compares normalized values

`x-unique` comparison is **normalized by default**: string values are
Unicode case-folded before hashing, so `Alice@example.com` and
`alice@example.com` are one unique value, register once, and resolve to the
same user regardless of typed casing. Non-string values are unaffected. A
property whose values are case-sensitive by nature (external IDs, codes)
opts out per property: `x-unique` widens from a scope string to also accept
an object form — `"x-unique": {"scope": "project", "compare": "exact"}` —
with the string shorthand meaning normalized comparison.
Trimming is not normalization — schemas reject
padded input through validation (`pattern`/`format`) instead of silently
mutating it.

This is a single comparison function shared by the uniqueness constraint,
the unique-attributes registry hash, and every identifier resolution
lookup. It cannot be split: normalizing only lookups lets two casings of
one address register as distinct "unique" values and then makes every
lookup ambiguous; normalizing only writes leaves sign-ins failing on
casing. The stored attribute keeps its original casing for display.

Today the hash is computed over the raw JSON encoding, making uniqueness
case-sensitive — a duplicate-account generator for emails (the industry
lesson: AWS Cognito shipped case-sensitive usernames, then had to bolt on a
setting and flip the default). Nothing is stored in production yet, so the
comparison function is a code change now and a backfill-with-latent-
collisions later. Extends [ADR 008](008-users-eav-store.md)'s uniqueness
enforcement; oxidel's ADR-016 normalizes all unique values the same way
(lowercase), without the per-property opt-out.

### 5. Identifier resolution in auth attempts

The direct-API `IdentifierProof` carries only `login_name`, and its current
implementation looks the user up with an empty attribute key — it can never
match. Under this ADR:

- On the flow path, the identifier field must name the bound schema's
  designated property; resolution is the single-attribute lookup the storage
  layer already has. "Any `x-unique` property can identify" (the
  [#142](https://github.com/zitadel/nextgen/pull/142) rule) is retired;
  `x-unique` goes back to meaning uniqueness only.
- On the direct API, an auth attempt is project-scoped, not schema-scoped: a
  bare `login_name` resolves against the **designated identifier of each user
  schema in the project** — a set derived from the per-schema scalars, one
  entry per schema. The value must match **exactly one user across that
  set**; zero or several matches reject the proof. Never resolve by schema
  or property precedence — precedence is how classic Zitadel let one user's
  username shadow another user's email at login
  ([zitadel/zitadel#10782](https://github.com/zitadel/zitadel/issues/10782)).
  With a single user schema (the shipped default) the set has one entry and
  this degenerates to the same single-attribute lookup as the flow path.
- **An identifier lookup is scoped.** It matches only rows of the designated
  property, on users of the schema in scope, and only rows carrying a
  uniqueness scope. Without this, an equal value in an unrelated property —
  a non-unique notification `email` on another schema — would collide with a
  legitimate identifier and break its login. This scoping is what makes the
  flow path fully collision-proof: nothing outside the bound schema's
  designated property can interfere.
- **Designated identifier values are unique across designations.** Writing a
  value into any designated identifier property requires that no other
  designated identifier property in the same resolution scope holds it —
  otherwise one user registering another user's identifier as their own
  (e.g. a username equal to someone's email) locks the victim out of the
  cross-schema resolution above. This rule is contract from day one;
  enforcement is staged: a service-layer check at designated-identifier
  writes now (one lookup per designating schema; concurrent writes can race
  past it) and a conflict scan when a schema update redesignates its
  identifier — existing values in the newly designated property may already
  collide, and the update must fail with the conflicts named — with
  reject-at-login as the backstop for race remnants —
  degraded, never unsafe — and the dedicated cross-key storage namespace
  (see Revisit) upgrading it to a guarantee later. Formats that keep
  co-designated properties disjoint (usernames without `@`, E.164 phone
  numbers) are recommended to schema authors but never required — like
  splitting login surfaces per schema, that is a customer choice, not a
  safety mechanism.

Distinct account types that share a person — the "admins also have an admin
account under the same email address" pattern — are modeled as separate
schemas, not as multiple identifiers on one schema: `human-user` designates
`email`; `admin-user` designates `username`, keeps its `email` property
non-unique as a notification address, and can require stronger
`x-auth-methods`. Each schema stays scalar; the cross-schema resolution rule
above makes both sign-ins work from one project, and the scoped lookup keeps
the shared notification address from ever touching resolution.

### 6. Visibility and audit

- Ref fields (`identifier`, `display`) are readable by any principal that can
  read the **referencing** resource. Designation *is* the consent to label:
  `session.read` shows session refs, a future `grant.read` shows grant refs.
  No additional `user.read` requirement — this retires the question
  [#869](https://github.com/zitadel/nextgen/issues/869) parked, generically.
  Designation is also the sensitivity decision: a schema author must not
  designate a value they consider secret. (The former `x-sensitive`
  annotation was removed as unread in
  [#901](https://github.com/zitadel/nextgen/pull/901); if a sensitivity
  marker returns, it must bar designation.)
- The identifier **used at authentication** is audit data, not display data.
  It belongs in wide-event payloads at emit time
  ([ADR 048](048-wide-events-internal-audit-primitive.md)) — snapshot
  semantics in the one place snapshots are wanted. Session responses do not
  carry it. Recording the value follows the `x-audit` contract
  ([#901](https://github.com/zitadel/nextgen/pull/901)): audit payloads are
  deny-by-default, so the used identifier's value appears in the event only
  when the property carries `x-audit: true` — otherwise the payload names
  the property, not the value.

### 7. Convention retired, defaults updated

`domain.IdentityAttributeKeys` and `User.DisplayName()` (the hard-coded
`name`/`givenName`/`familyName` spellings) are deleted, not kept as fallback —
a silent fallback would recreate exactly the invisibility
[#956](https://github.com/zitadel/nextgen/issues/956) describes.
`default-human-user.json` gains `x-identifier: "email"`. Session responses
replace the flat `name`/`email` fields with an embedded `user` ref; the
`<zitadel-session>` component and console app shell move to the ref's fallback
chain. Pre-release, both consumers are in-repo.

## Context

The platform assumes fixed property names whenever it must show *who* a user
is, while user schemas are free-form — the problem record is
[#956](https://github.com/zitadel/nextgen/issues/956). The pressure points:

- `GET /sessions/me` resolves `name`/`email` by spelling convention; a schema
  using `surname` gets a raw ULID in the console. The shipped default schema
  defines only `email`, so the convention's name-parts logic matches nothing
  that actually ships.
- [#869](https://github.com/zitadel/nextgen/issues/869) would copy those
  convention fields onto the session list — and each future user-linked
  surface (grants, memberships, events) would copy them again.
- The direct-API identifier proof is non-functional: no attribute name on the
  wire, empty-key lookup in `verify`. The wire comment "login name or email"
  wants a designated identifier to resolve against; none exists.
- A schema-level identifier designation existed: `x-identifier` (per-property
  boolean) shipped with the first schema API and was removed by
  [#71](https://github.com/zitadel/nextgen/pull/71) /
  [#142](https://github.com/zitadel/nextgen/pull/142) ("`x-unique` is now the
  only identity marker"), with no ADR. The collapse is harmless inside the
  flow engine, which names its fields explicitly — and wrong everywhere else:
  `unique` does not imply `identifier`, multiple unique properties give no
  order, and team-scoped unique properties are built for a team-restricted
  login that does not exist yet, so offering them as identifiers in today's
  project-wide login fails by design.

## Alternatives considered

- **Per-property `x-identifier: true` (the removed design).** Two marked
  properties give a set with no way to pick one — JSON Schema property order
  carries no meaning. The root-level keyword naming the property is the fix,
  not the revert.
- **An ordered list (`x-identifiers: ["email", "username"]`) per schema.**
  Considered and deferred. Classic Zitadel's experience supports starting
  singular: most of its multi-identifier surface ("use email to login" as a
  username format toggle) worked around a fixed, mandatory username field —
  schema-designation serves that case with a scalar, and parallel account
  types (admin accounts by username beside human accounts by email, a real
  customer pattern) are separate schemas resolved by the cross-schema rule
  in §5, not multiple identifiers on one schema. What remains for a list is
  the genuine either-or input within one account population (email *or*
  phone, [zitadel/zitadel#7409](https://github.com/zitadel/zitadel/issues/7409))
  — absent from this product today. The scalar widens to an ordered array
  idiomatically (as JSON Schema's `type` does), and §5's
  exactly-one-across-the-set resolution already generalizes to it.
- **Keep the spelling convention as fallback.** Invisible magic is the
  problem being solved; a fallback resurrects it and hides designation
  mistakes instead of surfacing them.
- **Snapshot the authenticating identifier onto the user factor and render
  sessions from it.** Rejected for display: the same user would carry
  different labels across rows depending on how they logged in, and non-auth
  resources (grants, memberships) have no snapshot moment at all. The
  snapshot survives as audit data in event payloads (§6).
- **Allow designating the envelope `user_id` as an identifier.** Refs carry
  `user_id` unconditionally, so it adds nothing for display; the only added
  semantic would be login-by-ID on the direct API, which we deliberately do
  not open. IDs stay the implicit last-resort label. Machine schemas that
  authenticate by client credentials designate a real `client_id` attribute —
  an ordinary project-unique property.
- **A display template language instead of a property list.** Deferred;
  `x-display` as an ordered list covers the known cases and a template can
  amend this ADR later without breaking it.
- **Requiring `x-identifier` unconditionally.** Machine and pseudonymous
  schemas legitimately designate nothing, and schema-level requirement cannot
  guarantee instance-level presence anyway (that would need the property in
  `required`, which breaks imports and machine users). The conditional rule
  in §1 catches the real misconfiguration class.

## Consequences

Easier:

- Every current and future user-linked surface (sessions today; grants,
  memberships, events read-side next) adopts one existing contract instead of
  re-deciding fields, fallbacks, and permissions.
- Schema authors see their choice: designation is explicit, validated, and
  its absence is visible instead of silently degrading to a ULID.
- The broken direct-API identifier proof gets a defined resolution rule.

Harder / to do:

- Meta-schema changes land in both copies (`packages/config/meta-schemas/` and
  `api/openapi/endpoints/schemas/`), plus validator, flow resolver
  (identifier fields restricted to designated properties), and the shipped
  defaults.
- The designation rules exceed what the user meta JSON Schema can express —
  cross-referencing that the named property exists, its uniqueness scope,
  the conditional requirement, and the redesignation conflict scan — so they
  land as Go-side schema validation, the same pattern the flow-definition
  validator already uses.
- `/sessions/me` is a breaking wire change for `<zitadel-session>` and the
  console shell; `@zitadel/api-mock` session fixtures must be diffed and
  updated in lockstep (its AGENTS.md parity rule).
- No schema migration: nothing is stored in production yet, so the keywords
  land together with the updated defaults and the §1 validation applies to
  every schema write from the start.

Revisit later:

- Team-restricted login: once a team-qualified resolution context exists,
  admit an `x-unique: "team"` property as `x-identifier` (§1) and render it
  on refs within team-scoped views.
- Multi-property login within one schema: widen `x-identifier` from a string
  to an ordered array (§1) when a single account population should sign in
  with "email *or* phone"
  ([zitadel/zitadel#7409](https://github.com/zitadel/zitadel/issues/7409)).
  The resolution semantics need no new decision — the widened set joins §5's
  cross-schema set under the same exactly-one, reject-ambiguity rule. The
  industry norm is multiple identifiers (Auth0, Cognito, Keycloak — all as
  fixed-type toggles); Ory Kratos, the schema-driven peer, allows multiple
  per-property designations backed by one shared uniqueness namespace.
- Constraint-backed identifier namespace: §5's cross-designation uniqueness
  rule is enforced by a service-layer check today, which concurrent writes
  can race past. A dedicated cross-key storage structure (Kratos-style
  identifier table or partial index) upgrades it to a database guarantee.
  Not free: attribute uniqueness today is per-key, so this needs a new
  structure in every dialect plus backfill-and-conflict semantics when a
  schema redesignates its identifier. With mixed scopes, the namespace
  follows the resolution context — one project namespace plus one per team —
  which stays clean only while contexts are disjoint; a team login that also
  accepts project-scoped identifiers overlaps them, and there §5's
  reject-at-login rule remains the backstop rather than cross-scope
  write-time checks.
- Display templates (locale-aware ordering, separators) as an amendment.
- Whether events' emitted payloads adopt the ref shape wholesale or only the
  used-identifier snapshot.
- Meta-schema versioning: the served `user-schema.json` gains two keywords;
  whether that warrants a version bump follows the meta-schema's general
  versioning story, which this ADR does not decide.

## Adoption

1. Fix `IdentifierProof` resolution against `x-identifier` (own bug issue —
   the path is currently dead).
2. Reframe [#869](https://github.com/zitadel/nextgen/issues/869): session list
   and operator get return `user` refs via the batch resolution port.
3. Migrate `/sessions/me`, `<zitadel-session>`, console shell, and the user
   list/detail screens ([#956](https://github.com/zitadel/nextgen/issues/956)'s
   surfaces) to the ref fallback chain.
