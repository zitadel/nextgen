---
"@zitadel/sdk-react": patch
---

Tests now check that an unset widget prop leaves the web component's own default in place in the React components, and that a prop cleared after being set restores it. The behaviour comes from `@zitadel/components`, so the React wrappers pass their props straight through.
