# Grant principal identification

> **Status:** OPEN (exploration — no wire change yet)
> **Date:** 2026-09-08
> **Context:** [`POST /grants`](../../../api/openapi/endpoints/grants/methods.yaml)
> currently accepts only `principal_type` + `principal_id`. Callers often
> have an email or a team name, not an opaque id, and they must not be given
> a platform-user directory in order to find one.
>
> Builds on [ADR 053](../../adrs/053-cross-project-principals.md),
> [ADR 054](../../adrs/054-customer-collaboration-grants.md),
> [ADR 058](../../adrs/058-user-identity-designation-and-references.md).
> Classic Zitadel's "organization" is **team** in this model
> ([glossary](../glossary.md#9-renames-locked)).

This note compares ways to name the principal on create without turning
`grant.create` into a user-list permission. It is not an ADR. If a shape is
accepted, follow-up amends ADR 054 §4 / §6 and the OpenAPI create body.

## Problem

`POST /grants` writes an `authz_assignments` row. The row's principal is
always a stored id (`user_<opaque>` or `team_<opaque>`). That storage
choice is correct and is not in question.

The HTTP create body currently requires that same id:

```yaml
# api/openapi/endpoints/grants/create-grant-request.yaml (today)
required: [principal_type, principal_id, relation]
```

Two facts make that insufficient:

1. **Callers often do not have the id.** Console and API consumers know
   "grant `ada@example.com` viewer" or "grant the Acme AI Admins team
   editor". Opaque ids are an implementation handle, not the value a
   person types.
2. **They must not list the platform directory to find it.** Collaboration
   grants target principals homed in the **platform project** (ADR 053/054).
   `POST /users/query` requires `user.read` on that project. Giving every
   project administrator `user.read` on the platform project is a global
   directory. ADR 054 testing obligation 12 is explicit: validating a
   principal must not enumerate platform users or teams.

The create path already does a **point lookup** by id and returns
`grant.principal_not_found` without listing. The gap is that the only
lookup key is the id itself.

`POST /users/query` cannot close the gap even for callers who do have
`user.read`: its filter fields are `id`, `schema`, `status`, `team_id`,
`lifecycle_owner_team_id`. There is no identifier / email filter today.

## What can uniquely identify a principal

Lookup keys have to already be unique in the principal's **home** project
(the platform project when one is pinned; otherwise the protected project,
matching today's id path in `GrantService.resolvePrincipalHome`).

| Principal | Key | Unique? | Notes |
|---|---|---|---|
| User | `id` | Yes | Prefixed opaque PK. Today's only create key. |
| User | designated **identifier** | Yes, at project scope | ADR 058 `x-identifier` value (default schema: `email`). Same resolution as a bare `login_name`: exactly one match across designated identifier properties of in-scope schemas; zero or several reject. Normalized comparison. |
| User | display name | **No** | `x-display` is presentational. Never a locator. |
| User | undesignated unique attribute | **No (as a grant key)** | ADR 058 retired "any `x-unique` property can identify". Uniqueness ≠ identifier. |
| User | schema-shaped `attributes` bag | **No** | Couples `/grants` to a particular user schema. |
| Team | `id` | Yes | Prefixed opaque PK. |
| Team | `name` | Yes, per project, case-insensitive | Already enforced on create/rename. `POST /teams/query` matches `name` case-insensitively. |
| Team | display-only fields | n/a | Team ref carries `name`; there is no second label. |

There is no `organization` resource. A paying account, agency, or access
group is a **team in the platform project**. A B2B end-customer tenant is
a team in a customer project and is not a collaboration-grant principal
(ADR 054 §4: principals are platform-project users and teams).

**RECOMMENDED locators for create:** user id, user identifier, team id,
team name. Nothing else in v1.

## Constraints that any option must keep

These are already decided elsewhere. A locator design that breaks them is
out of scope, not a variant.

- **Storage stays id-based.** Resolve at write; persist `principal_id`.
  Identifier and team name can change later; the assignment must not.
- **Home project is server-side.** ADR 053: `principal_home_project_id`
  is never accepted from the body. Identifier/name lookup uses the same
  home rule as today's id lookup — platform project when pinned, else
  the protected project. Never search the protected project's end-user
  directory when a platform project exists (that would bind customer
  end-users as collaborators).
- **No directory.** Point lookup only: equals, not `contains`, not prefix
  search, not a paginated candidate list.
- **`grant.create` does not imply `user.read` / `team.read`.** Resolution
  is a privileged server-side existence check, the same class as today's
  `loadPrincipal`. The create **response** may still carry a user/team
  ref (ADR 058 §6: refs ride the referencing resource). That labels the
  principal just granted; it is not a listing of others.
- **Active only.** Inactive / missing / wrong kind / wrong home collapse
  to the same `grant.principal_not_found` the id path already uses, so
  the locator does not grow a new oracle beyond "this exact value is
  currently grantable".
- **No invitations.** Unknown identifier → not found. Pending invites,
  email handshakes, and agency discovery remain ADR 054 non-goals.

The residual risk is an **existence oracle** on guessable values (emails,
team names). The id path already 404s for unknown ids; ids are unguessable.
Identifier lookup makes the oracle useful. That is inherent in "grant by
email" (GitHub collaborator add, Google Cloud IAM `user:email@…` have the
same shape). Mitigations: exact match only, uniform 404, existing 429 on
the endpoint, `grant.create` required. Do not return "did you mean", match
count, or which property matched.

## Options

### A. Keep ids; add a resolve endpoint

```http
POST /principals/resolve   # body: locator → { type, id, ref }
POST /grants               # unchanged: principal_type + principal_id
```

Create stays simple. Memberships, invites, and the console typeahead could
reuse one resolver.

Cost: two round trips; the resolve endpoint **is** the oracle, now as its
own operation, so it still needs the same permission and uniform-404
rules. Callers who only want to grant pay for an extra contract. Does not
by itself stop a client from calling resolve in a loop.

**OPEN** as a later shared primitive. Not sufficient alone for the create
UX, and not required to ship locators on create.

### B. Flattened XOR fields on create

```json
{
  "principal_type": "user",
  "principal_id": "user_01H…",          // xor
  "identifier": "ada@example.com",      // xor, user only
  "name": "Acme AI Admins",             // xor, team only
  "relation": "viewer"
}
```

Additive for today's clients: `principal_id` remains. Easy to type.

Cost: OpenAPI cannot say XOR without `oneOf`. Sending two locators, or
`principal_type: user` with `name`, becomes a service-layer 400.
`identifier` and `name` sit at the top level next to `relation`, which
hides that they are locator keys. `name` is ambiguous in a payload that
might one day grow a grant label.

**Not recommended** as the public shape. Fine as an internal mapping
behind a `oneOf`.

### C. Nested `principal` locator (`oneOf`) — **RECOMMENDED**

Replace `principal_type` + `principal_id` with a discriminated locator.
`relation` and `expires_at` stay siblings. The grant **response** is
unchanged: `principal_type`, `principal_id`, plus user/team refs.

```json
{
  "relation": "viewer",
  "expires_at": "2027-01-01T00:00:00Z",
  "principal": { "type": "user", "id": "user_01KZZY8PX8K8ATNVDSMRCZY4N1" }
}
```

```json
{
  "relation": "viewer",
  "principal": { "type": "user", "identifier": "ada@example.com" }
}
```

```json
{
  "relation": "editor",
  "principal": { "type": "team", "id": "team_01KZZY8PX8K8ATNVDSMRCZY4N1" }
}
```

```json
{
  "relation": "admin",
  "principal": { "type": "team", "name": "Acme AI Admins" }
}
```

Sketch (OpenAPI 3.1, ogen `oneOf` as used by identifier/password/passkey
proofs — unique required properties, no `discriminator` mapping required):

```yaml
principal:
  oneOf:
    - title: UserById
      type: object
      required: [type, id]
      additionalProperties: false
      properties:
        type: { type: string, const: user }
        id: { $ref: ../../components/schemas/user-id.yaml }
    - title: UserByIdentifier
      type: object
      required: [type, identifier]
      additionalProperties: false
      properties:
        type: { type: string, const: user }
        identifier:
          type: string
          minLength: 1
          description: |
            ADR 058 designated identifier (typically email). Resolved in
            the principal home project; exactly one active user.
    - title: TeamById
      type: object
      required: [type, id]
      additionalProperties: false
      properties:
        type: { type: string, const: team }
        id:
          type: string
          description: `team_<opaque>`
    - title: TeamByName
      type: object
      required: [type, name]
      additionalProperties: false
      properties:
        type: { type: string, const: team }
        name:
          type: string
          minLength: 1
          description: |
            Team name, unique per home project case-insensitively.
```

Resolution (service, same transaction as today's `loadPrincipal`):

1. Id variants: existing prefix check + `GetResourceScope` + active
   user/team in home project.
2. `UserByIdentifier`: `GetUser` with `UniqueAttributesOnly` against the
   home project's designated identifier properties (ADR 058 §5
   exactly-one-across-the-set). Do **not** pass a client-supplied
   attribute key — that would reintroduce precedence.
3. `TeamByName`: `GetTeam` on home project, active, name equals
   case-insensitive.
4. Persist the resolved id. Response hydates refs as today.

Alpha may break the create body; there is no compatibility obligation.
Existing integration tests that post `principal_id` would move to
`principal: { type, id }`.

This is the same idea as Google Cloud IAM's `user:email@…` /
`group:name@…`, typed instead of string-prefixed so OpenAPI and ogen
stay honest.

### D. Invitation when the locator misses

If identifier/name does not match, create a pending invite instead of
404. That is a different resource (token, expiry, accept flow, email).
ADR 054 deferred it. Mixing it into `POST /grants` makes "grant to an
existing principal" and "invite someone who may not have an account"
share one status machine.

**Rejected for this change.** Keep 404. Invite is a later surface that
can reuse the same locator vocabulary.

### E. Open `POST /users/query` (and teams) to grant administrators

Add an identifier filter and let `grant.create` on a customer project
query platform users.

**Rejected.** That is the directory ADR 054 forbids. Even a
single-result "search" with `contains` is enumeration. Operators who
already have `user.read` on a project may still want an identifier
**equals** filter for *that* project's own users — a separate, narrower
gap, not a collaboration-grant API.

## Comparison

| | A Resolve + create | B Flattened XOR | C Nested `oneOf` | D Invite-on-miss | E Query as directory |
|---|---|---|---|---|---|
| Names user without id | Indirect | Yes | Yes | Yes | Yes |
| Names team without id | Indirect | Yes | Yes | — | Yes |
| OpenAPI XOR | n/a | Weak | Strong | — | n/a |
| Extra endpoints | Yes | No | No | Yes (invite) | No (widens query) |
| Directory / listing | Resolve loop | No | No | No | **Yes** |
| Fits ADR 054 §4/§12 | If resolve is point-lookup | Yes | Yes | Different product | **No** |
| Breaking create body | No | Optional | Yes (alpha) | — | No |

## Recommendation

**Ship C** on `POST /grants` when we change the wire.

- Keep id locators so automation that already has ids does not go
  backwards.
- Add user `identifier` (ADR 058, not a hard-coded `email` field).
- Add team `name` (the org-shaped handle in this model).
- Resolve in the principal home; store ids; leave GET/query/delete
  unchanged.
- Uniform `grant.principal_not_found` for miss / inactive / wrong home /
  wrong type / ambiguous identifier (ambiguous is rare once
  cross-designation uniqueness is enforced; leaking "this value collides"
  is not useful to the grantor).
- Do not add `contains`, display-name lookup, schema `attributes`, or
  client-supplied `identifier_property` in v1.

Optionally extract the resolver as A later if memberships or invites need
the same locators. Do not block create on that.

## Open questions

1. **Ambiguous identifier error code.** Collapse to `principal_not_found`
   (no extra leak) vs `grant.invalid` with a field path (actionable for
   operators debugging two schemas). Leaning: not-found, same as auth
   attempt reject-ambiguity, unless we learn operators cannot recover.
2. **Team name vs slug.** Names are unique but are also the display
   string and can be renamed. Lookup-at-write is fine; a stable slug is
   not in the team resource today. Do not invent one here.
3. **Self-hosted with no platform project.** Today's id path allows any
   homed principal. Identifier/name lookup should use the protected
   project as home in that mode — same branch as `platformProjectID == ""`.
4. **Identifier filter on `POST /users/query`.** Useful for operators
   with `user.read` on their own project. Independent of grants; do not
   couple it to `grant.create`.
5. **Shared locator component.** If C ships, the same `oneOf` could be a
   reusable schema for later invite/membership APIs. Worth extracting on
   the second consumer, not the first.

## Non-goals

- Changing how assignments are stored or authorized.
- Granting to customer-project end-users as collaborators.
- Listing or searching platform principals.
- Invite / accept / email handshake.
- Accepting classic Zitadel `org_id` / `granted_org_id` names on the
  wire.

## If accepted

- Amend ADR 054 §4 ("user ID or team ID") and §6 ("names the target user
  or team ID") to "id, user identifier, or team name", still without a
  directory.
- Replace `create-grant-request.yaml`; keep `grant.yaml` response fields.
- Resolve in `GrantService.Create` before `CreateAuthzAssignment`; reuse
  unique-attribute lookup and team name uniqueness, do not add a new
  storage API unless the current `GetUser` / `GetTeam` filters cannot
  express exactly-one identifier-across-schemas.
- Tests: identifier and name happy paths; uniform 404 for unknown /
  inactive / other-project / end-user-in-protected-project; XOR / oneOf
  rejection; no `user.read` required; create response still carries refs.
