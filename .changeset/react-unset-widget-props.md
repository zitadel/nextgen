---
"@zitadel/sdk-react": patch
---

A widget prop that goes back to unset (or is passed as `undefined`) now restores the web component's own default in the React wrappers, instead of leaving `undefined` on the element. For example, `<ZitadelSession heading="Hi" />` rerendered as `<ZitadelSession />` shows the default "Signed in as" title again rather than an empty one.
