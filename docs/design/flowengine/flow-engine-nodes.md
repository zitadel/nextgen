# Flow Engine — Step Response Shape

> **Status:** Decided — Capability Payloads + LiquidJS Templates
> **See also:** [Flow Engine](flow-engine.md) · [User Schema Integration](user-schema.md) · [ADR-048](https://github.com/zitadel/oxidel/blob/main/docs/adr/048-capability-driven-login-payloads.md)

## Resolution

The original question — how to structure interactive elements and who controls their visual order — is resolved by **separating data from presentation entirely**.

The backend emits **unordered semantic capabilities** (what the user can/must do). A **LiquidJS template** controls the visual structure, element ordering, labels, and layout. The frontend is a dumb renderer that parses the template and mounts Lit Web Components.

This eliminates the need to choose between Options A, B, or C. The backend never expresses ordering. The template handles it.

## Step Response Structure

Every step response contains three capability dictionaries and step-level metadata:

```json
{
  "step": {
    "name": "identifier",
    "type": "identifier",
    "texts": {
      "title_key": "identifier.title",
      "description_key": "identifier.description"
    },

    "fields": {
      "identifier": {
        "type": "email",
        "required": true,
        "text_key": "identifier.field.email"
      }
    },

    "actions": {
      "submit": {
        "primary": true,
        "text_key": "identifier.action.submit"
      },
      "register": {
        "text_key": "identifier.action.register"
      },
      "passkey": {
        "text_key": "identifier.action.passkey"
      }
    },

    "gates": {
      "captcha": {
        "type": "captcha",
        "provider": "altcha",
        "required": true,
        "satisfied": false,
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
| `fields` | `Record<string, FlowField>` | Data the user must provide. Keyed by field name. Unordered. |
| `actions` | `Record<string, FlowAction>` | Available user actions. Keyed by action name. Unordered. |
| `gates` | `Record<string, FlowGate>` | Security gates (captcha, passkey ceremony). Keyed by gate type. Unordered. |
| `sso_providers` | `SSOProvider[]` | Available SSO identity providers. |
| `texts` | `Record<string, string>` | Step-level text keys for localization (resolved client-side via `| t` filter). |
| `branding` | `FlowBranding` | Layout selection, custom CSS, and the Liquid template string. |

## How Ordering Works

The backend **never** controls element order. The LiquidJS template does.

**Default login (email first, SSO below):**
```liquid
<h2>{{ step.texts.title_key | t }}</h2>

{% for field in fields %}
  <zl-field name="{{ field[0] }}" label="{{ field[1].text_key | t }}" type="{{ field[1].type }}"></zl-field>
{% endfor %}

{% if actions.submit %}
  <zl-submit label="{{ actions.submit.text_key | t }}"></zl-submit>
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

{% for field in fields %}
  <zl-field name="{{ field[0] }}" label="{{ field[1].text_key | t }}" type="{{ field[1].type }}"></zl-field>
{% endfor %}

{% if actions.submit %}
  <zl-submit label="{{ actions.submit.text_key | t }}"></zl-submit>
{% endif %}
```

Both templates consume the **exact same backend response**. The admin switches layouts by changing the template, not by asking the backend to reorder data.

## Registration

Registration steps use the same structure. Schema fields are emitted as capabilities:

```json
{
  "step": {
    "name": "register_profile",
    "type": "form",
    "texts": {
      "title_key": "register.title"
    },
    "fields": {
      "email": { "type": "email", "required": true, "text_key": "register.field.email" },
      "given_name": { "type": "text", "required": true, "text_key": "register.field.given_name" },
      "family_name": { "type": "text", "required": true, "text_key": "register.field.family_name" }
    },
    "actions": {
      "submit": { "primary": true, "text_key": "register.action.submit" },
      "login": { "text_key": "register.action.login" }
    },
    "gates": {}
  }
}
```

The template decides whether first/last name are side-by-side or stacked:
```liquid
<div class="grid-2">
  <zl-field name="given_name" label="{{ fields.given_name.text_key | t }}"></zl-field>
  <zl-field name="family_name" label="{{ fields.family_name.text_key | t }}"></zl-field>
</div>
<zl-field name="email" label="{{ fields.email.text_key | t }}"></zl-field>
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
  "identifier.title": "Welcome back",
  "identifier.description": "Sign in to continue",
  "identifier.field.email": "Email address",
  "identifier.action.submit": "Continue",
  "identifier.action.passkey": "Sign in with passkey",

  "password.title": "Enter your password",
  "password.description": "Hi, {{displayName}}",
  "password.field.password": "Password",
  "password.action.submit": "Sign in",
  "password.action.back": "Change account",

  "register.title": "Create your account",
  "register.field.email": "Email",
  "register.field.given_name": "First name",
  "register.field.family_name": "Last name",
  "register.action.submit": "Create account"
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
| Step title | `step.texts.title_key` | `identifier.title` |
| Step description | `step.texts.description_key` | `identifier.description` |
| Field label | `field.text_key` | `identifier.field.email` |
| Action label | `action.text_key` | `identifier.action.submit` |

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
| "How do we extract fields for a `<form>` tag?" | Trivially — `fields` is its own dictionary. |
| "Schema validation complexity?" | Minimal — three uniform dictionaries, no discriminated unions. |

The capability payload is simpler than any of the three original options, while providing more flexibility than all of them combined.
