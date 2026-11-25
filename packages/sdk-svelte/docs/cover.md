# @zitadel/sdk-svelte

Svelte 5 components for the Zitadel auth UI, for client-side single-page apps (Vite and similar). Use it when your Svelte app needs a sign-in flow, a sign-out control or a signed-in session card and you want to drop them in as components instead of building the screens yourself.

## Main components

- {@link ZitadelLogin} renders the sign-in flow. Use it on the page that signs a visitor in; its props are {@link ZitadelLoginSvelteProps}.
- {@link ZitadelLogout} renders a sign-out control. Use it where the app needs a stand-alone sign-out button; its props are {@link ZitadelLogoutSvelteProps}.
- {@link ZitadelSession} renders the signed-in session card with a sign-out action. Use it to show who is signed in; its props are {@link ZitadelSessionSvelteProps}.
- {@link configureZitadel} creates the {@link ZitadelProject} handle that the components take as `project`, and {@link getZitadelConfig} and {@link getApi} read it back.
- {@link businessLocales} is the business copy overlay for the `locales` prop. It is re-exported so apps need no direct `@zitadel/components` dependency.

The three components are `.svelte` files, which TypeDoc cannot read. This reference documents them from the declarations the build emits, so each appears as a constant of type `Component`. Their props are the types above; the event callbacks receive the payload types such as {@link ZitadelFlowCompleteDetail}.

## How it works

The components are not compiled ahead of time. The package ships their source through the `svelte` export condition, and your app's Svelte build compiles them. Each one is a thin wrapper around a custom element (`<zitadel-login>`, `<zitadel-logout>`, `<zitadel-session>`) defined by `@zitadel/components`, which the package imports for you.

In server-rendered markup the wrapper writes the tag with the `project-id` and `proxy-path` attributes taken from `projectId` and `proxyPath`, or from the `project` handle. The `project` handle itself is a property-only value, so it is left out of server markup and assigned as a property in the browser. The custom element definitions exist only in the browser; on the server the tag is plain markup until the page upgrades it. If you server-render, either mount the widget after hydration or pass `projectId` and `proxyPath` as strings, because a widget that starts before its configuration arrives shows an error instead of the flow.

Props the element has defaults for (such as `variant`, `theme` and `suppressHeader`) are assigned only when you set them, so an unset prop keeps the element's default. Event callbacks may return a promise; for the events that navigate (flow complete, flow redirect, sign-out) the widget waits for it, up to two seconds, before it navigates.

The widgets call `${proxyPath}/...` on the app's own origin, `/__nextgen` by default. That same-origin proxy fronts the Zitadel API, so the browser never talks to it cross-origin. The CLI dev proxy provides it locally; production deployment of a single-page app is not yet supported (see the README).

## Edge runtimes

The entry loads on Cloudflare Workers and Vercel Edge without a DOM. On those runtimes the components package resolves to a build with no custom elements, so importing the entry registers nothing, and rendering a component on the server produces the widget tag with its attributes. The element definitions, the flow itself and everything interactive run only in the browser after the page upgrades the tag.

## Where to go next

- The [README on GitHub](https://github.com/zitadel/nextgen/tree/main/packages/sdk-svelte#readme) lists every widget prop and event, with installation and the proxy setup.
- Start with {@link ZitadelLogin}, then {@link configureZitadel} to create the handle you pass to it.
