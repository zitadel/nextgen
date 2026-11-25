Angular components for the Zitadel sign-in UI, for client-side single-page apps. Each component wraps one of the Zitadel web components (`<zitadel-login>`, `<zitadel-logout>`, `<zitadel-session>`) so that you can bind inputs and outputs the Angular way instead of driving a custom element by hand. It is for Angular 19 and later apps, because the inputs are signal inputs (`input()`) and the events are `output()` outputs, which Angular 19 made stable. You bind them in templates exactly as before that talk to Zitadel through a same-origin proxy.

## Main components

- {@link ZitadelLogin} renders the sign-in, registration and other flows (`<zitadel-auth-login>`). Use it on your login page.
- {@link ZitadelLogout} renders the sign-out widget (`<zitadel-auth-logout>`). Use it where a user ends their session.
- {@link ZitadelSession} renders the signed-in "signed in as" card with a sign-out action (`<zitadel-auth-session>`). Use it after sign-in.
- {@link configureZitadel} builds the frozen {@link ZitadelProject} handle you pass to each component through `[project]`. Call it once per app.
- {@link getApi} and {@link getZitadelConfig} are the same functions every other SDK exports: the typed API client for a project handle, and the handle registered by {@link configureZitadel}.
- `businessLocales` is the business copy overlay of `@zitadel/components`, re-exported so a scaffolded app can pass it as `locales` without depending on that package directly.

The types for the props, the event details and the handlers are listed under the package's type aliases and interfaces, for example {@link ZitadelProject}, {@link ZitadelConfig} and {@link ZitadelFlowPurpose}. {@link ZitadelLoginProps}, {@link ZitadelLogoutProps} and {@link ZitadelSessionProps} describe each component's inputs only; the events are outputs.

## How it works

The wrappers are standalone, compiled Angular components, not dynamic ones: there is no NgModule or provider to register, and each template is fixed at build time. A template renders the real custom element under `CUSTOM_ELEMENTS_SCHEMA`, which is why the selectors are `zitadel-auth-login`, `zitadel-auth-logout` and `zitadel-auth-session` and not the element names.

Configuration reaches the element two ways. The inputs are declared with `input()`. The `project` handle, `projectId`, `proxyPath`, `locales` and the boolean options are bound as DOM properties. `project-id`, `proxy-path`, `url`, `purpose`, `flow-name`, `post-sign-in-url`, `resume-flow-id`, `variant`, `theme` and `lang` (login) are also bound as attributes, so server-rendered markup carries them before hydration. Properties and callbacks are not in the server markup. The widget's `zitadel-*` events are re-emitted as Angular outputs (`flowStep`, `flowInput`, `flowComplete`, `flowRedirect`, `flowError`, `signout`), declared with `output()`, carrying the event's `detail`. The underlying element is available from each component's `element` getter.

Importing the package registers the custom elements, but only in a browser. The element definitions exist only there; on the server the tags are plain unknown elements until the browser upgrades them. Mount the login widget on the client only, after hydration, or use a raw `<zitadel-login>` with `project-id` and `proxy-path` attributes, because a widget that starts before its configuration arrives shows an error instead of the flow.

The widgets call `${proxyPath}/...` on your app's own origin, `/__nextgen` by default. In development the CLI proxy provides it; in production your hosting platform must route that path to Zitadel, and production SPA deployment is not yet supported (see the README).

## Edge runtimes

The package loads without a DOM, because the edge build of `@zitadel/components` registers no elements and does not touch `HTMLElement`. Angular's own edge support is the limit: its server rendering targets Node, and the application builder produces a bundle without Node APIs only through the experimental `ssr.platform: "neutral"` option. In an app built with that option and `conditions: ["workerd", "browser"]`, the three wrappers bundle, load and server-render inside the `edge-runtime` VM, each as its custom element tag with its attributes, and `lang` is left out when unset. Without those `conditions` the build stops with `document is not defined`, because the components root then loads Lit. The builder applies `conditions` to the browser bundle too, and the edge components build registers no elements, so that bundle does not register the widgets: the browser side of an edge deployment has not been verified.

## Where to go next

Read the [README](https://github.com/zitadel/nextgen/tree/main/packages/sdk-angular#readme) for installation, the full props and events tables and deployment notes. Start from {@link configureZitadel} and {@link ZitadelLogin}.
