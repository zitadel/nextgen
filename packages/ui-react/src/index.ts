/**
 * `@zitadel/ui-react` — paired React implementations of the
 * `@zitadel/components` Lit atoms. These exist for the internal Zitadel
 * console, which is a pure React app and so cannot use the Lit-only `<zl-*>`
 * custom elements without an adapter. We deliberately avoid `@lit/react` so the
 * console ships zero Lit runtime; both layers share visuals through the
 * design-tokens CSS variables.
 *
 * Source-of-truth for visuals: the matching Lit atoms in
 * `packages/components/src/atoms/`. Both renderers consume the same `.zr-*`
 * surface CSS from `@zitadel/shared-component-styles`, so parity is structural.
 * These React pairs have no component-level spec; their behaviour is exercised
 * by the `React` story's `play` in `apps/storybook/` (run via
 * `@storybook/addon-vitest`), while the Lit atoms' behaviour is owned by the
 * `packages/components` specs.
 */
export { Button, type ButtonProps } from "./button.js";
export { Checkbox, type CheckboxProps } from "./checkbox.js";
export { TextField, type TextFieldProps } from "./text-field.js";
export { Alert, type AlertProps } from "./alert.js";
export { Pill, ZitadelAttributionPillLabel, type PillProps } from "./pill.js";
export { Icon, type IconName, type IconProps, type IconSize, type IconTone } from "./icon.js";
export { Card, type CardProps } from "./card.js";
export { PageShell, type PageShellProps } from "./page-shell.js";
export { Select, type SelectProps, type SelectOption } from "./select.js";
