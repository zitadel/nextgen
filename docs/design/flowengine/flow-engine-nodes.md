# Flow Engine — Step Response Shape

> **Status:** Decided — Capability Payloads + LiquidJS Templates
> **See also:** [Flow Engine](flow-engine.md) · [User Schema Integration](user-schema.md) · [ADR 021](../../adrs/021-ordered-arrays-for-step-fields-actions-gates.md)

## Resolution

The original question — how to structure interactive elements and who controls their visual order — is resolved by **separating data from presentation entirely**.

The backend emits **semantic capabilities** (what the user can/must do). Per [ADR 021](../../adrs/021-ordered-arrays-for-step-fields-actions-gates.md), `fields` and `actions` are **ordered arrays** whose entries carry a `name`; `gates` remains keyed by gate type. A **LiquidJS template** controls the visual structure, labels, and layout — it iterates the arrays in order or looks entries up by name, and it may reorder freely. The frontend is a dumb renderer that parses the template and mounts Lit Web Components.

This eliminates the need to choose between Options A, B, or C. The definition's array order gives templates a stable default; the template owns the final layout.

## Step Response Structure

Every step response contains the capability collections and step-level metadata:

```json
{
  "step": {
    "name": "login",
    "texts": {
      "title_key": "login.title",
      "description_key": "login.description"
    },

    "fields": [
      {
        "name": "email",
        "type": "email",
        "required": true,
        "text_key": "login.field.email"
      }
    ],

    "actions": [
      {
        "name": "submit",
        "kind": "submit",
        "primary": true,
        "text_key": "login.action.submit"
      },
      {
        "name": "register",
        "kind": "navigate",
        "text_key": "login.action.register"
      },
      {
        "name": "passkey",
        "kind": "passkey",
        "text_key": "login.action.passkey"
      }
    ],

    "gates": {
      "captcha": {
        "kind": "captcha",
        "provider": "altcha",
        "config": {
          "algorithm": "SHA-256",
          "challenge": "abc...",
          "salt": "xyz...",
          "max_number": 100000
        }
      }
    },

    "sso_providers": [
      { "id": "google-1", "name": "Google", "template": "google" },
      { "id": "entra-1", "name": "Microsoft", "template": "entraid" }
    ],

    "branding": {
      "layout": "centered",
      "liquid_template": "..."
    }
  }
}
```

### Key properties

| Property | Type | Purpose |
|---|---|---|
| `fields` | `FlowField[]` | Data the user must provide. Ordered array; each entry carries `name`. Resolved from user schema at runtime. |
| `actions` | `FlowAction[]` | Available user actions. Ordered array; each entry carries `name` and `kind`. |
| `gates` | `Record<string, FlowGate>` | Security gates (captcha, passkey ceremony). Keyed by gate type. |
| `sso_providers` | `SSOProvider[]` | Available SSO identity providers. |
| `texts` | `Record<string, string>` | Step-level text keys for localization (resolved client-side via `| t` filter). |
| `complete` | `string \| null` | Terminal step indicator: `"redirect"` or `"show"`. Null for non-terminal steps. |
| `branding` | `FlowBranding` | Layout selection, custom CSS, and the Liquid template string. |

## How Ordering Works

The array order gives templates a stable default, but the LiquidJS template owns the final layout — it can iterate in order, reorder, or pull individual entries by name.

**Default login (email first, SSO below):**
```liquid
<h2>{{ step.texts.title_key | t }}</h2>

{% for f in fields %}
  <zl-field name="{{ f.name }}" label="{{ f.text_key | t }}" type="{{ f.type }}"></zl-field>
{% endfor %}

{% assign submit = actions | where: "name", "submit" | first %}
{% if submit %}
  <zl-submit label="{{ submit.text_key | t }}"></zl-submit>
{% endif %}

{% if sso_providers.size > 0 %}
  <div class="divider">or</div>
  <zl-sso-providers providers="{{ sso_providers | json }}"></zl-sso-providers>
{% endif %}
```

**SSO-first login (same backend payload, different template):**
```liquid
<h2>{{ step.texts.title_key | t }}</h2>

{% if sso_providers.size > 0 %}
  <zl-sso-providers providers="{{ sso_providers | json }}"></zl-sso-providers>
  <div class="divider">or use email</div>
{% endif %}

{% for f in fields %}
  <zl-field name="{{ f.name }}" label="{{ f.text_key | t }}" type="{{ f.type }}"></zl-field>
{% endfor %}

{% assign submit = actions | where: "name", "submit" | first %}
{% if submit %}
  <zl-submit label="{{ submit.text_key | t }}"></zl-submit>
{% endif %}
```

Both templates consume the **exact same backend response**. The admin switches layouts by changing the template, not by asking the backend to reorder data.

## Registration

Registration steps use the same structure. Schema fields are emitted as capabilities:

```json
{
  "step": {
    "name": "profile",
    "texts": {
      "title_key": "profile.title"
    },
    "fields": [
      { "name": "email", "type": "email", "required": true, "text_key": "profile.field.email" },
      { "name": "given_name", "type": "text", "required": true, "text_key": "profile.field.given_name" },
      { "name": "family_name", "type": "text", "required": true, "text_key": "profile.field.family_name" }
    ],
    "actions": [
      { "name": "submit", "kind": "submit", "primary": true, "text_key": "profile.action.submit" },
      { "name": "login", "kind": "navigate", "text_key": "profile.action.login" }
    ],
    "gates": {}
  }
}
```

The template decides whether first/last name are side-by-side or stacked:
```liquid
{% assign given = fields | where: "name", "given_name" | first %}
{% assign family = fields | where: "name", "family_name" | first %}
{% assign email = fields | where: "name", "email" | first %}
<div class="grid-2">
  <zl-field name="given_name" label="{{ given.text_key | t }}"></zl-field>
  <zl-field name="family_name" label="{{ family.text_key | t }}"></zl-field>
</div>
<zl-field name="email" label="{{ email.text_key | t }}"></zl-field>
```

## Captcha / Bot Detection

Security gates are capabilities, not visual elements. The template places them:

```liquid
{% if gates.captcha %}
  <zl-captcha provider="{{ gates.captcha.provider }}" config="{{ gates.captcha.config | json }}"></zl-captcha>
{% endif %}
```

If a template forgets to render a required gate, the orchestrator appends it automatically as a safety net.

## Translation Pipeline (The `| t` Filter)

The backend **never sends display text**. It sends semantic `text_key` strings (e.g. `"identifier.field.email"`). All human-readable text is resolved **client-side** by the `<zitadel-login>` orchestrator using a custom LiquidJS filter called `| t`.

### How it works

1. The orchestrator loads a JSON locale dictionary (e.g. `en.ts`, `de.ts`) at boot time.
2. When LiquidJS encounters `{{ field.text_key | t }}`, the `| t` filter looks up the key in the active dictionary and returns the localized string.
3. If the key is missing, the filter returns the raw key as a fallback (useful for debugging and custom schema fields).

### Dictionary structure

Keys follow a strict `step.scope.name` convention:

```json
{
  "login.title": "Welcome back",
  "login.description": "Sign in to continue",
  "login.field.email": "Email address",
  "login.field.password": "Password",
  "login.action.submit": "Continue",
  "login.action.passkey": "Sign in with passkey",
  "login.action.register": "Create account",
  "login.action.recover": "Forgot password?",

  "profile.title": "Create your account",
  "profile.field.email": "Email",
  "profile.field.given_name": "First name",
  "profile.field.family_name": "Last name",
  "profile.action.submit": "Continue",
  "profile.action.login": "Already have an account?"
}
```

### Interpolation

The `| t` filter supports basic string interpolation for dynamic values. The template passes context as a second argument:

```liquid
<!-- The description key "password.description" contains "Hi, {{displayName}}" -->
<p>{{ step.texts.description_key | t: identity.display_name }}</p>
<!-- Renders: "Hi, Alice" -->
```

### The backend contract

The backend emits `text_key` on every element that has human-readable text:

| Element | Property | Example key |
|---|---|---|
| Step title | `step.texts.title_key` | `login.title` |
| Step description | `step.texts.description_key` | `login.description` |
| Field label | `field.text_key` | `login.field.email` |
| Action label | `action.text_key` | `login.action.submit` |

This design ensures:
- **The backend never hardcodes display text.** It emits keys; the frontend resolves them.
- **Locale switching is instant.** Swap the dictionary, re-render the template. No server round-trip.
- **Custom schemas work automatically.** If a tenant adds a `department_code` field, the backend emits `text_key: "identifier.field.department_code"`. The tenant adds that key to their custom dictionary. No frontend code changes.

## Why Options A/B/C Are Obsolete

The original debate centered on **who controls element ordering** — the backend (via array position) or the frontend (via hardcoded section layout). With LiquidJS templates, the answer is **neither**:

| Old Concern | Resolution |
|---|---|
| "Can admins put SSO above the email field?" | Yes — edit the template. Backend is unchanged. |
| "Can fields be interleaved with non-fields?" | Yes — the template places elements arbitrarily. |
| "Does the frontend need `switch(element.kind)`?" | No — the template emits explicit `<zl-*>` components. No type discrimination. |
| "How do we extract fields for a `<form>` tag?" | Trivially — `fields` is its own array. |
| "Schema validation complexity?" | Minimal — uniform arrays plus a keyed gate map, no discriminated unions. |

The capability payload is simpler than any of the three original options, while providing more flexibility than all of them combined.
