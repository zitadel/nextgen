---
"@zitadel/sdk-core": minor
"@zitadel/sdk-react": minor
"@zitadel/sdk-vue": minor
"@zitadel/sdk-svelte": minor
"@zitadel/sdk-solid": minor
"@zitadel/sdk-qwik": minor
"@zitadel/sdk-tanstack-start": minor
---

The ZitadelLogin, ZitadelLogout and ZitadelSession wrappers of the React, Vue, Svelte, Solid and Qwik SDKs now pass the standard HTML attributes (class, style, id, title, slot, hidden, role, tabindex, data-* and aria-*) to the widget element, so an app can position, style and label a widget without an extra wrapper element, and their props types accept exactly those attributes besides the widget's own props. All five use one definition, standardAttributes in @zitadel/sdk-core/types, which also exports the widgetTags constant that names the three widget elements. This changes behaviour for React and Vue callers: those wrappers used to pass every extra prop or attribute on to the element, and now pass only the standard attributes, so a prop such as an event handler, srcdoc or part no longer reaches the element. In Angular the component tag already carries the standard attributes, so that SDK is unchanged. The TanStack Start entry re-exports the new React types.
