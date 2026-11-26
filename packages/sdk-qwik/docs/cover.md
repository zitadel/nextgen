Qwik components for the Zitadel sign-in, sign-out and signed-in-session widgets.
The package wraps the `<zitadel-login>`, `<zitadel-logout>` and
`<zitadel-session>` web components from `@zitadel/components` so a Qwik 2 app
can use them as ordinary components, with Qwik QRL callbacks for the widget's
events. It is for developers building a Qwik or Qwik Router app that signs
users in through Zitadel.

## Main components

- [[ZitadelLogin]] renders the sign-in (or register) flow. Use it on your login
  and register pages; `purpose` picks which.
- [[ZitadelLogout]] renders a sign-out button that ends the session and then
  navigates. Use it wherever a bare "Sign out" action is enough.
- [[ZitadelSession]] renders the "signed in as" card with a sign-out button. Use
  it on pages that confirm who is signed in.
- [[configureZitadel]], [[getApi]] and [[getZitadelConfig]] set, use and read
  back the project configuration shared by every widget, so you can configure the
  project once instead of passing it to each component.
- [[businessLocales]] is the business-copy locale overlay, re-exported so an
  app does not need a direct `@zitadel/components` dependency.

The props of each component are [[ZitadelLoginProps]], [[ZitadelLogoutProps]] and
[[ZitadelSessionProps]].

## How it works

Each component is static: the custom element is written directly in the
component's JSX, not built at render time from a tag name. What happens where:

- **Server-rendered markup.** The attribute-backed configuration is emitted into
  the HTML: `project-id`, `proxy-path`, `url`, `publishable-key`, and the
  per-widget attributes such as `purpose`, `flow-name`, `resume-flow-id` and
  `post-sign-out-url`. Under Qwik Router the server markup is resumed rather
  than re-rendered, so these attributes are what the widget reads the moment it
  upgrades. The publishable key is safe to expose by design.
- **Browser only.** The custom elements are defined when `@zitadel/components`
  is imported in the browser; on the server there are no element definitions, so
  the markup is just the unknown tags with their attributes. Qwik 2 binds
  custom-element props as attributes only, so property-only configuration (the
  full `project` handle, `locales`) is assigned as DOM properties in the browser:
  in a `ref` callback at mount, and again by a `useVisibleTask$` whenever a prop
  changes.
- **Same-origin proxy.** The widgets call the Zitadel API through `/__nextgen`
  on your own origin (change it with `proxyPath`). Your app, or its dev server,
  has to forward that path to the API.
- **Events and the QRL callbacks.** Each `on...$` prop is a Qwik QRL, which loads
  lazily and runs asynchronously. The widgets navigate right after
  `zitadel-flow-complete`, `zitadel-flow-redirect` and `zitadel-signout`, so a
  QRL that had not yet run could be cut off by the page unloading. The wrapper
  therefore passes the promise the callback returns to the event's `waitUntil`
  (the detail's `waitUntil` hook), and the widget waits for it, for at most two
  seconds, before it navigates. A callback that returns nothing delays nothing.
- **Early events.** Under SSR a widget that boots from `resume-flow-id` can reach
  a terminal step before the wrapper's listeners are attached. A small buffer
  installed before the elements register holds only the terminal events
  (flow-complete, flow-redirect, flow-error, signout) and replays them in order
  when the wrapper attaches, so a callback such as the handoff-token exchange is
  never missed. Input events, which can carry passwords, are never stored.

## Edge runtimes

The entry loads on Cloudflare Workers and Vercel Edge without a DOM. On those
runtimes `@zitadel/components` resolves to a build with no custom elements, so
importing this package does not touch `HTMLElement` or `document`, and
registering the elements simply does nothing. The components render on the server
into markup with the attributes above, using `renderToString`; the widget itself
only comes alive once the page reaches the browser. The edge spec runs the
built package in the edge runtime and checks that the exports are present and
that each component renders its attributes.

## Where to go next

- The [README](https://github.com/zitadel/nextgen/tree/main/packages/sdk-qwik#readme)
  has installation, setup and the proxy configuration.
- Start with [[ZitadelLogin]] and [[ZitadelLoginProps]], then
  [[ZitadelSession]] and [[ZitadelLogout]].
- In Qwik Router, `@zitadel/sdk-qwik-router` handles the server-side session and also
  re-exports these widgets from `@zitadel/sdk-qwik-router/components`, so that one package is enough.
