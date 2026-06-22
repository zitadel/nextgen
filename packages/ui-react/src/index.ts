/**
 * `@zitadel/ui-react` — paired React implementations of the
 * `@zitadel/components` Lit atoms. These exist for the internal Zitadel
 * console, which is a pure React app and so cannot use the Lit-only `<zl-*>`
 * custom elements without an adapter. We deliberately avoid `@lit/react` so the
 * console ships zero Lit runtime; both layers share visuals through the
 * design-tokens CSS variables.
 *
 * Source-of-truth for visuals: the matching Lit atoms in
 * `packages/components/src/atoms/`. The Playwright spec in
 * `apps/console-e2e/` compares the rendered output of each pair against its
 * Lit counterpart.
 */
export { Button, type ButtonProps } from "./button.js";
export { TextField, type TextFieldProps } from "./text-field.js";
export { Alert, type AlertProps } from "./alert.js";
export { Pill, ZitadelAttributionPillLabel, type PillProps } from "./pill.js";
export { Icon, type IconName, type IconProps, type IconSize, type IconTone } from "./icon.js";
export { Card, type CardProps } from "./card.js";
export { PageShell, type PageShellProps } from "./page-shell.js";
