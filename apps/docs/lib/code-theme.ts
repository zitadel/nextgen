import { createCssVariablesTheme } from "shiki/core";

// Code in the console's syntax colours, as the console's schema viewer draws
// it (apps/console/src/lib/highlight.ts): Shiki's CSS-variables theme emits
// `var(--zl-shiki-*)`, which app/global.css aliases onto the design system's
// syntax roles, so code switches with data-theme like everything else.
const theme = createCssVariablesTheme({ name: "zitadel", variablePrefix: "--zl-shiki-" });

// One theme for both modes: the variables carry the light and the dark values.
export const codeThemes = { light: theme, dark: theme };
