# Component Capability Map

> **Status:** Design reference
> **See also:** [Branding and Templates](README.md) · [Templates](templates.md) · [Step Response Shape](../flowengine/flow-engine-nodes.md) · [User Schema Integration](../flowengine/user-schema.md)

This document maps flow-engine capabilities to frontend components for design
and implementation planning. Schema field names describe the data being
collected; they do not usually imply distinct visual components. Most fields are
variants of the same input atom.

## Component Mapping Principle

Components should be chosen by capability and field metadata, not by schema key.
For example, `given_name`, `family_name`, `display_name`, and `company` are all
text fields and should render with the same base field component.

```json
{
  "given_name": { "type": "text", "text_key": "register.field.given_name" },
  "family_name": { "type": "text", "text_key": "register.field.family_name" }
}
```

Both map to:

```liquid
<zl-field
  name="{{ field[0] }}"
  type="{{ field[1].type }}"
  label="{{ field[1].text_key | t }}"
></zl-field>
```

## Field Capabilities

| Schema field | Component | Type | Design purpose |
|---|---|---|---|
| `identifier` | `zl-field` | `email` or `text` | First login field. Usually email address or username. Often the primary field on the first screen. |
| `email` | `zl-field` | `email` | Email collection for registration, recovery, verification, or profile flows. Should support email keyboard, browser autocomplete, and clear validation states. |
| `password` | `zl-field` | `password` | Secret credential input. Needs masked value, password-manager compatibility, and room for future reveal or strength affordances. |
| `code` | `zl-field` | `code` or `text` | OTP or verification-code input. Should visually support short codes and can later evolve into segmented input without changing the schema field. |
| `given_name` | `zl-field` | `text` | First name. Same component as other text fields; often paired side-by-side with `family_name`. |
| `family_name` | `zl-field` | `text` | Last name. Same component as `given_name`; design should support grouped name layouts. |
| `display_name` | `zl-field` | `text` | Profile or public display name. Same text input with profile-oriented label and help text. |
| `company` | `zl-field` | `text` | Optional organization/company field. Same text input, usually lower emphasis when optional. |
| `phone` | `zl-field` | `tel` | Phone number. Needs telephone keyboard support and may later need country-code treatment. |
| `address.street` | `zl-field` | `text` | Address line. Same text field, normally grouped with other address fields. |
| `address.city` | `zl-field` | `text` | City field. Same text field, normally grouped with address fields. |
| `address.zip` | `zl-field` | `text` | Postal or ZIP code. Same field component, often designed with a shorter layout width. |
| Custom schema fields | `zl-field` | schema-derived | Tenant-defined fields. Should render with the generic field component unless a future specialized renderer is explicitly introduced. |

Supported field input types:

| Field type | Component | Notes |
|---|---|---|
| `text` | `zl-field` | Default single-line text input. |
| `email` | `zl-field` | Email input semantics and autocomplete. |
| `password` | `zl-field` | Masked credential input. |
| `tel` | `zl-field` | Telephone keyboard and phone-friendly input. |
| `url` | `zl-field` | URL keyboard and validation semantics. |
| `number` | `zl-field` | Numeric input. Use carefully for values where browser number controls are appropriate. |
| `code` | `zl-field` | Short verification codes. Can be rendered as a normal input initially. |

## Action Capabilities

| Action | Component | Design purpose |
|---|---|---|
| `submit` | `zl-submit` | Main form CTA. Usually primary when `primary: true`. |
| `authenticate` | `zl-submit` or passkey-specific CTA | Primary passkey action. |
| `register` | `zl-action` | Secondary navigation from login to registration. |
| `login` | `zl-action` | Secondary navigation back to login. |
| `recover` | `zl-action` | Forgot-password action. Usually link-like or low-emphasis. |
| `resend` | `zl-action` | Secondary action for verification-code screens. |
| `back` | `zl-action` | Secondary navigation. |
| `fallback` | `zl-action` | Alternative authentication method, such as falling back from passkey to password. |
| `accept` | `zl-submit` | Primary consent or terms action. |
| `deny` | `zl-action` | Negative secondary consent action. |
| `decline` | `zl-action` | Negative secondary terms action. |

## Gate And Supporting Capabilities

| Capability | Component | Design purpose |
|---|---|---|
| `captcha` gate | `zl-captcha` | Bot-protection block. Should fit into forms without looking like a normal user-data field. |
| `passkey` gate | `zl-passkey` | Passkey ceremony, status, or prompt area. Used with passkey actions such as `authenticate` and `fallback`. |
| `sso_providers` | `zl-sso-providers` | Provider button group or list. Supports SSO-first or SSO-secondary layouts. |
| `messages` | `zl-message` | Informational or warning notices at step or form level. |
| `errors` | `zl-error` | Step-level or form-level errors. |
| `texts.title_key` | Template heading | Screen title. Usually rendered by the Liquid template rather than a dedicated atom. |
| `texts.description_key` | Template body copy | Supporting explanatory copy. Usually rendered by the Liquid template rather than a dedicated atom. |

## Minimal Component Inventory

The current schema and flow catalogue can be covered by this component set:

| Component | Covers |
|---|---|
| `zl-field` | All normal schema fields: text, email, password, phone, URL, number, code, and custom fields. |
| `zl-submit` | Primary submit-like actions. |
| `zl-action` | Secondary actions and navigation actions. |
| `zl-captcha` | Captcha gates. |
| `zl-passkey` | Passkey gates and ceremony UI. |
| `zl-sso-providers` | SSO provider lists. |
| `zl-message` | Informational and warning messages. |
| `zl-error` | Error messages. |

Specialized components should be introduced only when the interaction is truly
different from a normal field. Layout differences, such as placing first and
last name side-by-side or making ZIP code narrower, should come from the Liquid
template and design tokens rather than from separate field components.
