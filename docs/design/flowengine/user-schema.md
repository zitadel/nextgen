# User Schema Integration

> **Status:** Preliminary — depends on policy engine design
> **See also:** [Overview](README.md) · [Flow Engine](flow-engine.md) · [Session API](session-api.md)

This document describes how the **flow engine and policy engine consume user schemas** — not how user schemas themselves are defined or managed. The User Schema API and its full specification are a separate concern.

What matters here is the contract: which schema annotations exist, how the flow engine reads them to build capability payloads (fields, actions, gates), and how the policy engine reads them to narrow authentication requirements.

## Annotations Consumed by Flow & Policy

| Annotation | Scope | Consumer | Purpose |
|---|---|---|---|
| `writeOnly: true` | Field | Read API | Reserved for a value that may be written but is never returned. Nothing enforces it yet — responses currently include write-only properties |
| `x-audit: true` | Field | Audit emitter | Field value may appear in audit event payloads (allowlist; deny-by-default) |
| `x-unique: "<scope>"` | Field | Flow Engine | Server validates uniqueness on form submit at the given scope (`project` or `team`); a non-empty scope also marks the field as an identifier used for user resolution |
| `x-claim: "claims.email"` | Field | Flow Engine | Outbound only: the claim Zitadel emits for this property. Earlier drafts read it as inbound auto-population; that job belongs to IdP connections' `claim_mapping` ([`1-resource-model.md`](../idp/1-resource-model.md#claim-mapping)) |
| `x-auth-methods` | Schema | Policy Engine | Which auth methods this user type supports (narrows what policy can require) |

`writeOnly` is native JSON Schema, so the dialect does not declare it; the `x-*`
annotations are this dialect's.
Anything else a customer writes under a property is carried verbatim and
ignored — the dialect keeps `additionalProperties: true`, so an unrecognised
`x-*` key is accepted rather than rejected.

Audit event payloads use a **deny-by-default** PII policy: an attribute
contributes its key to the payload, and its value only when the property is
marked `x-audit: true`. See
[ADR 048](../../adrs/048-wide-events-internal-audit-primitive.md) §8.

## How the Flow Engine and Policy Engine Consume Schemas

```
User Schema                     Flow Definition                   Policy Engine
─────────────                   ───────────────                   ─────────────
Defines fields:                 References schema fields:         Reads schema annotations:
  email (x-unique: project)      step fields: [email, password]    x-auth-methods →
                                 step fields: [given_name, ...]     narrows available factors
  phone
  given_name                    user_schema: "human_user"         Reads user context:
  family_name                                                       user.roles, user.team →
  password                      Engine resolves field metadata      determines assurance level
  x-auth-methods:                 from schema annotations
    password: enabled            (type, validation, implicit       Returns decision:
    passkey: enabled              outcomes like user_not_found)      assurance decision
    sso: enabled
```

**The user schema narrows what the policy can require.** If a `service_account` schema has `x-auth-methods: { password: false, api_key: true }`, the policy engine cannot require a password — it's not available for that user type.

## Illustrative Schema Example

The following is an example user schema showing the annotations that the flow engine and policy engine consume. The actual schema format and API are defined separately.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "title": "Human User",
  "x-auth-methods": {
    "password":   { "enabled": true },
    "passkey":    { "enabled": true },
    "magic_link": { "enabled": true },
    "sso":        { "enabled": true }
  },
  "required": ["email", "given_name", "family_name"],
  "properties": {
    "email": {
      "type": "string",
      "format": "email",
      "title": "Email address",
      "x-unique": "project",
      "x-claim": "claims.email",
      "x-audit": true
    },
    "phone": {
      "type": "string",
      "title": "Phone number"
    },
    "given_name": {
      "type": "string",
      "title": "First name",
      "minLength": 1,
      "maxLength": 200,
      "x-claim": "claims.given_name"
    },
    "family_name": {
      "type": "string",
      "title": "Last name",
      "minLength": 1,
      "maxLength": 200,
      "x-claim": "claims.family_name"
    },
    "address": {
      "type": "object",
      "title": "Address",
      "properties": {
        "street": { "type": "string", "title": "Street" },
        "city":   { "type": "string", "title": "City" },
        "zip":    { "type": "string", "title": "ZIP code" }
      }
    }
  }
}
```

## Schema → Field Mapping

When a step references schema fields (via the `fields` array), the flow engine maps them to `fields` entries in the step response:

```
Schema property:                 Step field:
  "email": {                       {
    "type": "string",                "name": "email",
    "format": "email",               "label": "Email address",
    "title": "Email address",        "type": "email",
    "x-unique": "project"            "required": true,
  }                                  "validation": { "format": "email" }
                                   }
```

Mapping rules:
- `type` + `format` → field `type` (string/email → `email`, string → `text`)
- `title` → `label`
- `required[]` membership → `required: true`
- `minLength`, `maxLength`, `pattern` → `validation` object
- Nested objects (e.g., `address.street`) are flattened into individual fields

The schema is the **single source of truth** for field metadata. The flow definition only says _which_ fields to show and on _which_ step. Changing a field's label or validation in the schema automatically updates every flow that references it.

### Property names

A property name identifies one attribute, so it cannot contain a dot — a nested value is already
stored and addressed by its dotted path. The meta-schema enforces this over the `properties`
chain at every depth, and applies the annotation rules to nested properties along the way.

A name reached by any other route is not covered: `$defs`, `allOf`, `oneOf`, `anyOf`, `items`,
`patternProperties`, and `additionalProperties`-as-schema all describe subschemas the
`properties` chain never walks, and `UserProperty` keeps `additionalProperties: true` at its
root, so they are accepted. Making the constraint reach them means a `$dynamicAnchor: "meta"`
dialect extension, which propagates it across every subschema position at once but relies on
`$dynamicRef` support that not every editor has. Until then a dotted name declared under one of
those keywords and pulled in by `$ref` still produces an ambiguous attribute key.

## Progressive Profiling

Schemas enable progressive profiling by marking some fields as optional and deferring them to later flows:

1. **Registration flow:** collects `required` fields only (`email`, `given_name`, `family_name`, `password`)
2. **Post-login profiling flow:** the engine evaluates "does this user have a phone number?" — if not, injects a step with `fields: ["phone"]`
3. **Self-service flow:** user can edit the fields the flow's step lists

Each step's `fields` array selects which schema properties to show. The schema defines what's possible. The policy engine decides when profiling is needed.
