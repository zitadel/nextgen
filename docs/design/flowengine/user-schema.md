# User Schema Integration

> **Status:** Preliminary — depends on policy engine design
> **See also:** [Overview](README.md) · [Flow Engine](flow-engine.md) · [Session API](session-api.md)

This document describes how the **flow engine and policy engine consume user schemas** — not how user schemas themselves are defined or managed. The User Schema API and its full specification are a separate concern.

What matters here is the contract: which schema annotations exist, how the flow engine reads them to build BDUI forms, and how the policy engine reads them to narrow authentication requirements.

## Annotations Consumed by Flow & Policy

| Annotation | Scope | Consumer | Purpose |
|---|---|---|---|
| `x-identifier: true` | Field | Flow Engine | Field used for user resolution in the identifier step |
| `x-verify: "email"` | Field | Flow Engine | Flow engine can inject a verification step after collection |
| `x-mfa: "sms"` | Field | Policy Engine | Field can be used for OTP delivery |
| `x-sensitive: true` | Field | Flow Engine | Value redacted in audit events |
| `x-editable: true` | Field | Flow Engine | Field appears in profiling / self-service flows |
| `x-unique: "project"` | Field | Flow Engine | Server validates uniqueness on form submit (per-project scope) |
| `x-claim: "claims.email"` | Field | Flow Engine | Maps to SSO/OIDC claim for auto-population |
| `x-auth-methods` | Schema | Policy Engine | Which auth methods this user type supports (narrows what policy can require) |

## How the Flow Engine and Policy Engine Consume Schemas

```
User Schema                     Flow Definition                   Policy Engine
─────────────                   ───────────────                   ─────────────
Defines fields:                 References fields:                Reads schema annotations:
  email (x-identifier,           form step: show                   x-auth-methods →
         x-verify: email)          [email, given_name]               narrows available factors
  phone (x-mfa: sms)             form step: show
  given_name                       [password]                     Reads user context:
  family_name                    form step: show                    user.roles, user.team →
  password                         [phone] (skippable)              determines assurance level
  x-auth-methods:
    password: enabled            Builds UINodes from               Returns decision:
    passkey: enabled               schema field metadata             assurance_levels decision
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
    "password":   { "enabled": true,  "position": 1 },
    "passkey":    { "enabled": true,  "position": 0 },
    "magic_link": { "enabled": true,  "position": 2 },
    "sso":        { "enabled": true,  "position": 3 }
  },
  "required": ["email", "given_name", "family_name"],
  "properties": {
    "email": {
      "type": "string",
      "format": "email",
      "title": "Email address",
      "x-identifier": true,
      "x-verify": "email",
      "x-unique": "project",
      "x-claim": "claims.email",
      "x-editable": true
    },
    "phone": {
      "type": "string",
      "title": "Phone number",
      "x-mfa": "sms",
      "x-sensitive": true,
      "x-editable": true
    },
    "given_name": {
      "type": "string",
      "title": "First name",
      "minLength": 1,
      "maxLength": 200,
      "x-claim": "claims.given_name",
      "x-editable": true
    },
    "family_name": {
      "type": "string",
      "title": "Last name",
      "minLength": 1,
      "maxLength": 200,
      "x-claim": "claims.family_name",
      "x-editable": true
    },
    "address": {
      "type": "object",
      "title": "Address",
      "x-editable": true,
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

When a `form` step references schema fields, the flow engine maps them to `fields` entries in the step response:

```
Schema property:                 Step field:
  "email": {                       {
    "type": "string",                "name": "email",
    "format": "email",               "label": "Email address",
    "title": "Email address",        "type": "email",
    "x-identifier": true             "required": true,
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

## Progressive Profiling

Schemas enable progressive profiling by marking some fields as optional and deferring them to later flows:

1. **Registration flow:** collects `required` fields only (`email`, `given_name`, `family_name`, `password`)
2. **Post-login profiling flow:** a `policy_check` step evaluates "does this user have a phone number?" — if not, injects a `form` step for `["phone"]`
3. **Self-service flow:** user can edit any field with `x-editable: true`

The flow definition's `form` steps select which fields to show. The schema defines what's possible. The policy engine decides when profiling is needed.
