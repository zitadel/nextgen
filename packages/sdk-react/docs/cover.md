# @zitadel/sdk-react

React components and hooks for the Zitadel sign-in UI in a client-side SPA. The components wrap the framework-agnostic `<zitadel-login>`, `<zitadel-logout>` and `<zitadel-session>` web components, so a React app gets real components with typed props and callbacks instead of raw custom elements. It is for developers building a Vite, Create React App or similar single-page app that signs users in through Zitadel.

## Main components

- {@link configureZitadel} builds the project handle (project id and proxy path) once, before rendering. Pass the result as the `project` prop.
- {@link ZitadelLogin} renders the sign-in flow. Use it on your login route.
- {@link ZitadelLogout} renders the sign-out control. Use it in your account menu or profile page.
- {@link ZitadelSession} renders the signed-in "signed in as" card with a sign-out action.
- {@link useSession} tells your own components whether a user is signed in and who, for header navigation, account menus and route guards.
- {@link sessionStore} and {@link getSession} read the same session outside components, for a route guard or loader.
- {@link businessLocales} is a copy overlay you can pass as the `locales` prop of {@link ZitadelLogin}.

## How it works

The wrappers are built with `createComponent` from `@lit/react` when the module loads, so they are real React components that forward a `ref` to the underlying element. The `project` handle is bound as a DOM property, and each `zitadel-*` widget event reaches your callback (`onFlowStep`, `onFlowComplete`, `onSignout`, ...) as its `detail` payload. When a callback for a navigating event returns a promise, the widget waits for it (up to two seconds) before it navigates.

On the server, the wrappers write `project-id`, `proxy-path`, `url`, `publishable-key`, `variant`, `theme`, `lang` and the boolean options into the markup as attributes, because a widget that starts before its configuration arrives shows an error instead of the flow. The `project` handle is a property, and React 19 does not apply an object property while hydrating a server-rendered custom element, so on a server-rendered page pass `projectId` and `proxyPath` as strings. The publishable key is browser-safe, so a keyed handle travels as the `publishable-key` attribute and the first request carries it. An unset or empty `resumeFlowId`, `postSignInUrl` and `postSignOutUrl` write no attribute, and an empty `proxyPath` is written as `/`. Only this SDK exports session helpers; the other SDKs read the session through `@zitadel/sdk-core/session`.

The custom element definitions exist only in the browser: importing the package registers the elements there and does nothing on the server. The widgets call the backend through the same-origin `/__nextgen` proxy (the default `proxyPath`), so credentials stay on the app's own origin. In production your hosting platform must provide that path.

## Edge runtimes

The package loads on Cloudflare Workers and Vercel Edge, which have no DOM. The edge build of `@zitadel/components` defines no elements, so the import is a no-op there. A server render emits each widget by its tag name with the same attributes as on every other runtime, and the elements register only in the browser. Nothing renders into the widget on the server: the flow starts after the element upgrades in the browser. {@link useSession} reads nothing on a server and returns the `loading` status.

## Where to go next

- The [README on GitHub](https://github.com/zitadel/nextgen/tree/main/packages/sdk-react#readme) has installation, the prop and event tables and deployment notes.
- Start with {@link ZitadelLogin}, then {@link useSession} for your own UI.
