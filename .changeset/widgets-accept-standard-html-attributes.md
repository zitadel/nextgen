---
"@zitadel/sdk-core": minor
"@zitadel/sdk-react": minor
"@zitadel/sdk-vue": minor
"@zitadel/sdk-angular": minor
"@zitadel/sdk-svelte": minor
"@zitadel/sdk-solid": minor
"@zitadel/sdk-qwik": minor
"@zitadel/sdk-tanstack-start": minor
---

The ZitadelLogin, ZitadelLogout and ZitadelSession wrappers in every client SDK now accept the standard HTML attributes (class, style, id, title, slot, hidden, role, tabindex, data-* and aria-*) and forward them to the widget element, so an app can position, style and label a widget without an extra wrapper element. A widget prop always wins over a standard attribute of the same name, the props types include the element's HTML attributes, and each framework's own way to reach the element (a ref, a template ref, getElement or the Angular element getter) is unchanged. In Angular the attributes written on the wrapper's tag are moved to the widget element once, when the view is ready. The Solid, Qwik and Angular wrappers share one definition of the standard attributes, exported from @zitadel/sdk-core/types. The React wrappers' types are also exported as ZitadelLogoutReactProps and ZitadelSessionReactProps, and the TanStack Start entry re-exports them. The widget tag names are now defined once as widgetTags in @zitadel/sdk-core/types, and every wrapper and spec reads them from there.
