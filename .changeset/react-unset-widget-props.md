---
"@zitadel/sdk-react": patch
---

A widget prop that is cleared after being set (or passed as `undefined`) now restores the web component's own default in the React wrappers, instead of leaving `undefined` on the element, and an unset prop keeps that default. For example, `<ZitadelSession heading="Hi" />` rerendered as `<ZitadelSession />` shows the default "Signed in as" title again rather than an empty one.
