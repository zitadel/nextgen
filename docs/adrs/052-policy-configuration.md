# ADR 052: Policy and Setting Configuration

> **Status:** Draft
> **Date:** 2026-08-21
> **Context:** [#899](https://github.com/zitadel/nextgen/issues/899) defines the
> settings and policies model; [#383](https://github.com/zitadel/nextgen/issues/383)
> asks for the architecture. This ADR covers **where configuration lives and how it
> is authored**. [ADR 053](053-policy-evaluation.md) covers how it is evaluated.
> **Related:** [ADR 020](020-credentials-out-of-user-schema.md),
> [ADR 035](035-configuration-environments.md),
> [#898](https://github.com/zitadel/nextgen/issues/898)

## Context

Authentication methods are selected per user type in a user schema's
`x-auth-methods`. What a method *does* is not configurable at all — password
minimum length, passkey user verification and lockout thresholds are constants in
the server.

#899 defines the model for settings and policies but leaves open where the
configuration lives. Nothing can be built until that is settled.

## Terminology

One vocabulary, taken from #899 and extended only where it had no word.

| Term | Meaning |
|---|---|
| **Control** | Any configurable thing. The umbrella word. |
| **Setting** | Configures whether and how a capability is available. "Passkeys can be used." |
| **Policy** | A rule evaluated when an operation happens. It can restrict or deny an otherwise available operation. "Passwords need 12 characters." |
| **User state** | Facts about one person: enrolled passkeys, linked identities. Not configuration, never in a release. |
| **Owner** | The resource whose configuration holds the control. |
| **Applicability** | Which users or resources a control affects. Defined separately from the owner. |
| **Evaluation context** | The operation and target resource a policy applies to. |
| **Effective requirements** | The result of combining every policy applicable to one operation. |

The difference that matters: **a setting decides whether an operation is possible at
all; a policy decides whether a possible operation is permitted.** Policies from
several owners combine into one effective requirement. Settings do not combine.

Words to stop using: "auth-method settings" for the whole thing, "policy" as an
umbrella for both kinds, and `policyRef` (which kind of control does it reference?).

## Decision 1 — Where does a control live?

### Option A — Inline in the user schema

```json
"x-auth-methods": {
  "password": { "enabled": true, "minLength": 10, "specialChars": true }
}
```

- **Pro:** one file, nothing to reference, reads well in a single-schema project.
- **Con:** every user type restates the rules and they drift.
- **Con:** tightening a password rule re-revisions every schema that carries it, mixing
  an attribute change and a security change in one diff.
- **Con:** contradicts ADR 020, which keeps the schema to user attributes.
- **Con:** a Team cannot own a schema, so Team-owned policies have nowhere to go.

### Option B — Its own resource, referenced by handle (chosen)

```json
// .zitadel/policies/strong-password.json
{ "kind": "auth-policy", "method": "password", "minLength": 10, "specialChars": true }
```

```json
// .zitadel/schemas/customer.json
"x-auth-methods": { "password": { "enabled": true, "policy": "strong-password" } }
```

- **Pro:** one rule in one place, shared by many schemas.
- **Pro:** independently revisioned; a security change is one reviewable diff.
- **Pro:** resolved by handle at release construction, exactly as a flow resolves
  `user_schema` today.
- **Pro:** the same resource can later be owned by a Team or an Application without
  moving it.
- **Con:** two files to understand instead of one.
- **Con:** a new failure mode — an unresolvable handle. It must fail at publish.

### Option C — One file per method, project-wide, no reference

```
.zitadel/policies/password.json
.zitadel/policies/passkey.json
```

The schema declares only availability; the file for that method applies to the whole
project.

- **Pro:** nothing to reference and nothing to resolve.
- **Pro:** one obvious place per method.
- **Con:** no divergence. Admins and customers cannot have different password rules,
  which is the case that motivates a separate resource at all.
- **Con:** adding a per-schema override later turns this into Option B anyway, with a
  resolution order to explain.

### Option D — One file for everything

```json
// .zitadel/policies.json
{ "password": { "minLength": 10 }, "passkey": { "userVerification": "required" } }
```

- **Pro:** smallest footprint — one file, one revision, one diff for a security review.
- **Con:** a single resource whose revision churns on unrelated edits.
- **Con:** no way to reference one method's rules individually or reuse them.
- **Con:** same lack of divergence as Option C.

**Decision: Option B.** It is the only option that lets different user types have
different rules while keeping one rule in one place, and it matches the second branch
of #899's open decision — configuration has its own owner and *applies to* users of a
schema, rather than being owned by the schema.

Options C and D are strictly simpler and forfeit only per-user-type divergence. If the
milestone must be smaller, D is the cheapest thing that could work, and B remains
reachable from it by adding an optional reference.

## Decision 2 — One resource kind or two?

### Option A — One resource holding both kinds

- **Pro:** one directory, one metaschema, one file to open.
- **Pro:** smaller change for the current milestone.
- **Con:** half the fields compose across owners and half do not, in one file.
- **Con:** a Team owning "is passkey available" is meaningless, but the file it would
  have to own carries that field.

### Option B — Separate settings and policy resources (chosen)

```
.zitadel/settings/authentication.json     what is available
.zitadel/policies/strong-password.json    what is required
```

- **Pro:** matches #899's classification requirement structurally, not just by
  convention.
- **Pro:** only policies need composition rules, ownership by Team, and effective-
  requirement reporting. Keeping them apart keeps those mechanisms off settings.
- **Con:** two kinds to document and two directories to learn.
- **Con:** the developer must know which bucket a new control belongs in.

**Decision: Option B.** The two kinds behave differently at runtime, so separating
them at authoring time is honest. Option A is defensible if the milestone must be
smaller; it is reachable back from B, and B is not reachable back from A without a
breaking move.

## Consequences

- The resource is revisioned-immutable from the start and travels in the ADR 035
  release bundle, occupying its reserved `policies` key.
- Unresolvable handles, invalid values and incompatible combinations are rejected at
  release validation, not at authentication time.
- Availability of a method stays in `x-auth-methods` — it is a setting and it is
  already there. Only behaviour moves out.
- A schema that names no policy gets a documented built-in default, so a
  single-schema project never has to write a reference to say nothing interesting.
  #899 requires every control to define its behaviour when no explicit configuration
  exists, and the built-in default is that definition.

## Open

- How a user schema declares that a user type may use a given identity provider. It
  is a setting under this vocabulary, it is undefined today, and both #898 and
  [#851](https://github.com/zitadel/nextgen/issues/851) depend on it. Today
  `x-auth-methods` accepts only `password`, `passkey`, `magic_link`, `sso` and `otp`,
  under `additionalProperties: false` — so a per-provider key such as `idp-google`
  does not validate.
- When a promoted change becomes effective for users who already exist. Raising a
  minimum password length does not say what happens to shorter passwords already in
  use. #899 requires every control to answer this.
- Whether Team-owned and Application-owned policies land in the same directory shape.
