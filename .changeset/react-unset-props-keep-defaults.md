---
"@zitadel/sdk-react": patch
---

The React widgets now keep the web component's own default when a prop is left unset, and restore it when a prop that was set is cleared. For example, `<ZitadelSession />` without a `heading` shows the default "Signed in as" title, and removing `heading` later brings it back. The behaviour comes from `@zitadel/components`, which the React components pass their props straight through to.
