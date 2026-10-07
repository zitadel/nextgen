# Component Capability Map

> **Status:** Design reference. The component columns name shipped atoms; rows marked *not built* have no atom yet.
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
[
  { "name": "given_name", "type": "text", "text_key": "register.field.given_name" },
  { "name": "family_name", "type": "text", "text_key": "register.field.family_name" }
]
```

Both map to:

```liquid
<zl-field
  name="{{ f.name }}"
  type="{{ f.type }}"
  label="{{ f.text_key | t }}"
></zl-field>
```

## Field Capabilities

| Schema field | Component | Type | Design purpose |
|---|---|---|---|
| `identifier` | `zl-field` | `email` or `text` | First login field. Usually email address or username. Often the primary field on the first screen. |
| `email` | `zl-field` | `email` | Email collection for registration, recovery, verification, or profile flows. Should support email keyboard, browser autocomplete, and clear validation states. |
| `password` | `zl-field` | `password` | Secret credential input. Needs masked value, password-manager compatibility, and room for future reveal or strength affordances. |
| `code` | `zl-field` | `text` | OTP or verification-code input. Should visually support short codes and can later evolve into segmented input without changing the schema field. |
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
| `date`, `hidden` | `zl-field` | In the contract's type list. The bundled template routes them to `zl-field` like any other non-checkbox, non-select type. |
| `checkbox` | `zl-checkbox` | Boolean fields. |
| `select` | `zl-select` | Fields with a closed set of values. |

## Action Capabilities

A runtime action's `kind` is one of `submit`, `passkey`, `passkey_register`, `navigate`, `back`. `back` is injected by the engine and cannot be declared in a flow definition. The bundled template picks the rendering from `primary` and the action's `name`:

| Action | Rendering | Design purpose |
|---|---|---|
| The `primary: true` action | `zl-button` (`hierarchy="primary"`, `type="submit"`) | Main form CTA. |
| `passkey`, when not primary | `zl-button` (`hierarchy="secondary"`) | Offer a passkey beside the main path. |
| `register` | Link with `data-action` | Secondary navigation from login to registration. |
| `sign_in` | Link with `data-action` | Secondary navigation back to login. |
| `recover` | Link on the password field's label row, or its own row when the step has no password field | Forgot-password action. |
| Actions of kind `back` | No visible control. The browser's back gesture submits it | Return to the previous step. |
| Any other secondary action | `zl-button` (`hierarchy="secondary"`) | Alternative paths, such as falling back from passkey to password. |

## Gate And Supporting Capabilities

| Capability | Component | Design purpose |
|---|---|---|
| `captcha` gate | *not built* | Bot-protection block. Should fit into forms without looking like a normal user-data field. |
| `challenge` (passkey) | `zl-passkey` | Runs the WebAuthn ceremony for a pending challenge. Passkeys are modelled as a challenge on the step, not as a gate. |
| `sso_providers` | `zl-sso-providers` | Provider button group or list. Supports SSO-first or SSO-secondary layouts. |
| `messages` | *not built* | Informational or warning notices. The component passes an empty list today. |
| `errors` | `zl-alert` for step-level errors; the field atom's `error` attribute for field-level ones | Step-level or form-level errors. |
| `texts.title_key` | Template heading | Screen title, rendered by the Liquid template into the card's `header` slot. |
| `texts.description_key` | Template body copy | Supporting explanatory copy, rendered by the Liquid template. |

## Component Inventory

The shipped atoms (`packages/components/src/manifests.ts`):

| Component | Covers |
|---|---|
| `zl-field` | Every field type except `checkbox` and `select`, including custom fields. |
| `zl-select` | `select` fields. |
| `zl-checkbox` | `checkbox` fields. |
| `zl-button` | Primary and secondary actions. |
| `zl-passkey` | The passkey ceremony. |
| `zl-sso-providers` | The SSO provider buttons. |
| `zl-alert` | Errors. |
| `zl-card`, `zl-page-shell` | The card and the shell around it. |
| `zl-icon`, `zl-pill` | Glyphs and status pills. |

Specialized components should be introduced only when the interaction is truly
different from a normal field. Layout differences, such as placing first and
last name side-by-side or making ZIP code narrower, should come from the Liquid
template and design tokens rather than from separate field components.
