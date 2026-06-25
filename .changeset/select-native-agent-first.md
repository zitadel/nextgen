---
"@zitadel/components": patch
"@zitadel/ui-react": patch
---

Make `<zl-select>` / `<Select>` agent-first by driving them with a real
native `<select>`.

The operable, accessible, form-associated, and automatable control is now a
real native `<select>` carrying the stable `data-testid="zitadel-select-${name}"`,
matching the native-control contract `<zl-field>` and `<zl-checkbox>` already
follow. Screen readers, keyboard users, password managers, native form
validation, and automation drivers (Playwright `selectOption`, the
chrome-devtools accessibility snapshot, the Codex in-app browser) all interact
with that native element and its options.

The Figma-styled trigger and popup are kept as a pointer-only visual layer:
they are `aria-hidden` and never in the tab order, so they no longer duplicate
the control in the accessibility tree. Mouse users still get the styled popup;
everyone else uses the native control. Both paths converge on `value`, emit
`zl-change`, and mirror form state. This fixes agents being unable to choose a
dropdown option (e.g. enum schema fields during CLI-driven user registration),
where the previous custom listbox exposed no targetable options.
