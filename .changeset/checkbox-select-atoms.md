---
"@zitadel/components": minor
---

Add the `Checkbox` and `Select` atoms in both renderers, and render the
`checkbox` and `select` field types in the orchestrator.

- `@zitadel/components`:
  - New form-associated `<zl-checkbox>` Lit atom (Figma `Checkbox` `4387:460`,
    `Checkbox / With Label` `6634:1868`): optional `label` (or default slot),
    `checked` / `disabled` / `required` / `value` / `name`, a `zl-change` event,
    and full form participation (`setFormValue` / `setValidity` / reset / focus
    delegation).
  - New form-associated `<zl-select>` Lit atom (Figma `Dropdown` `4397:4816`,
    `Input text` `4397:4098`): a select-only combobox following the WAI-ARIA
    pattern with keyboard navigation. Options accept either a JS array
    (`.options`) or a JSON `options` attribute; `value` / `placeholder` /
    `disabled` / `required` and a `zl-change` event.
  - New `chevron-down` icon.
  - Both atoms registered in the manifest registry.
  - Orchestrator: the default Liquid template now renders `select` and
    `checkbox` field types as `<zl-select>` / `<zl-checkbox>`; select options
    are built from the field's `validation.enum` via a new `selectOptions`
    filter.
- `@zitadel/ui-react`: new paired `<Checkbox>` and `<Select>` React components
  that mirror the Lit atoms' DOM and share their surface CSS.

Shared `checkbox.css` and `select.css` (+ their `lit/*-host.css`) were added to
`@zitadel/shared-component-styles`. No new design tokens were required.
