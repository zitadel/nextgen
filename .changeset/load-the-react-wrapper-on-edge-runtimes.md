---
"@zitadel/sdk-react": patch
"@zitadel/sdk-next": patch
---

`@zitadel/sdk-react` and the `@zitadel/sdk-next/client` entry now load on edge runtimes. The React wrapper no longer imports the element classes from `@zitadel/components`: it renders each widget by its tag name, registers the elements in the browser with a side-effect import, and looks the class up in the custom element registry when it renders, so the props, events, refs and server markup are unchanged. `@zitadel/sdk-next/client` registers the elements the same way and now exports `ZitadelLogin`, `ZitadelLogout` and `ZitadelSession` as types only, because a value export of a class cannot load without a DOM.
