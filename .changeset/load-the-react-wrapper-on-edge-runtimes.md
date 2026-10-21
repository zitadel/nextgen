---
"@zitadel/sdk-react": patch
"@zitadel/sdk-next": minor
"@zitadel/sdk-nuxt": minor
---

`@zitadel/sdk-react`, `@zitadel/sdk-next/client` and `@zitadel/sdk-nuxt` now load on edge runtimes. The React wrapper no longer imports the element classes from `@zitadel/components`: it renders each widget by its tag name, registers the elements in the browser with a side-effect import, and looks the class up in the custom element registry when it renders, so the props, events, refs and server markup are unchanged. Every client SDK entry now carries the same two lines for the components, the registering import and the `businessLocales` re-export, and none exports an element class.

**Breaking:** `@zitadel/sdk-next/client` and `@zitadel/sdk-nuxt` no longer export `ZitadelLogin`, `ZitadelLogout` and `ZitadelSession`, which no other SDK exports either, because a value export of a class cannot load without a DOM. Import the classes from `@zitadel/components` in browser-only code if you need them. To type a ref to a widget element, use `HTMLElementTagNameMap["zitadel-login"]`.
