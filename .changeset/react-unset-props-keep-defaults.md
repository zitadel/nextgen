---
"@zitadel/sdk-react": patch
---

An unset widget prop now leaves the web component's own default in place in the React components, and a prop that is cleared after being set restores that default, instead of leaving `undefined` on the element. For example, `<ZitadelSession />` without a `heading` shows the default "Signed in as" title rather than an empty one.
