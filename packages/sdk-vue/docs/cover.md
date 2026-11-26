`@zitadel/sdk-vue` is the Vue 3 package for adding Zitadel sign-in to a client-side app (a Vite SPA, for example). It wraps the Zitadel web components in Vue components, so you place a login, logout or session card in a template and pass it props and event handlers the Vue way.

## Main components

- {@link ZitadelLogin} renders the sign-in flow. Use it on your login route or inside a dialog.
- {@link ZitadelLogout} renders the sign-out control. Use it inside your app's own chrome.
- {@link ZitadelSession} renders the signed-in "signed in as" card with its sign-out action. Use it after sign-in.
- {@link configureZitadel} creates the project handle you pass as `project`; {@link getZitadelConfig} and {@link getApi} read the configuration back.
- {@link businessLocales} is a copy overlay you can pass as `locales` to the login widget.

## How it works

Each component is a runtime wrapper built with `defineComponent` and a render function that creates the element by its string tag (`zitadel-login`, `zitadel-logout`, `zitadel-session`). Vue never tries to resolve the tag as a Vue component, so no `compilerOptions.isCustomElement` setting is needed. The element definitions come from `@zitadel/components`, which this package imports at load; they only exist in the browser, and the widget starts after the element is upgraded.

The wrappers write `project-id` and `proxy-path` (and `url` and `publishable-key`, from a `project` handle) as kebab-case attributes, so server-rendered markup carries them. The `project` handle itself is bound as a DOM property, raw rather than as Vue's reactive proxy, because the widget does identity checks on it. A string prop you leave unset is bound as an attribute on the client and removed, so the element keeps its own default. Event details are re-emitted from the widget's `zitadel-*` events as Vue emits.

The widgets call the Zitadel API through a same-origin proxy path, `/__nextgen` unless you set `proxyPath`. Your app's host or dev server must provide that path.

Besides their own props, the components accept the standard HTML attributes (`class`, `id`, `aria-*`, and so on), which are passed to the widget element. Nothing else reaches it.

## Edge runtimes

The entry loads without a DOM. On Cloudflare Workers and Vercel Edge the components package resolves to a build with no element definitions, so importing this package does not throw. A server render produces the widget tag with its `project-id` and `proxy-path` attributes and nothing inside: the flow itself renders only in the browser, after hydration. Edge specs run this entry in Vercel's edge runtime.

## Where to go next

- The package [README](https://github.com/zitadel/nextgen/tree/main/packages/sdk-vue#readme) has installation, the props and events tables, and the deployment notes.
- Start with {@link ZitadelLogin}, then {@link configureZitadel}.
