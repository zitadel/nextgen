# @zitadel/sdk-solid

Solid components for the Zitadel sign-in UI, for client-side Solid apps (Vite
SPAs and similar). Each component wraps one of the Zitadel web components, so
you get the full login flow, the signed-in session card and the sign-out
button without building any of the screens yourself.

## Main components

- {@link ZitadelLogin} renders the sign-in flow (`<zitadel-login>`). Use it on
  your login page; it starts a flow for the given `purpose`, or resumes one.
- {@link ZitadelLogout} renders the sign-out widget (`<zitadel-logout>`). Use it
  where a visitor ends their session.
- {@link ZitadelSession} renders the "signed in as" card (`<zitadel-session>`)
  with a sign-out action. Use it after sign-in to show who is signed in.
- {@link configureZitadel} creates the {@link ZitadelProject} handle (project
  id and proxy path) that you pass to the components as `project`.
- {@link getZitadelConfig} and {@link getApi} read back the configuration and
  the API client for the configured project.
- {@link businessLocales} is the business copy overlay for the `locales` prop,
  re-exported so apps do not need a direct `@zitadel/components` dependency.

## How it works

The wrappers are dynamic. Each component builds its element at render time
with Solid's `Dynamic`, using the tag name (`zitadel-login`, `zitadel-logout`,
`zitadel-session`), instead of a DOM template that Solid's compiler would
create when the module is imported. This is deliberate: a template
compiled at import time needs a DOM, so the published dist could not load or
server-render on edge runtimes such as Cloudflare Workers and Vercel Edge. With
`Dynamic` the dist loads anywhere and renders to a plain custom element tag.
Do not replace `Dynamic` with a literal widget tag in the components.

Server-rendered markup contains the tag and its attributes only. The project
coordinates are written as the `project-id` and `proxy-path` attributes (and
`url` and `publishable-key` when the handle has them), so they are present before any script runs;
an empty proxy path is written as `/`, because the widget treats an empty
attribute as unset. The `project` handle is also bound as a DOM property,
which carries the publishable key and is what the element prefers once Solid
hydrates, and its fields win over the discrete `projectId` and `proxyPath`
props. The custom element definitions themselves exist only in the browser:
importing the package registers them there, and the widget upgrades and starts
its flow after hydration.

The widgets call the Zitadel API through a same-origin proxy path, `/__nextgen`
by default. Your app's host or dev proxy must forward that path to the
backend. Widget events (`zitadel-flow-complete`, `zitadel-signout` and the
others) reach your optional callbacks as the event `detail`; when a callback
for a navigating event returns a promise, the widget waits for it (up to two
seconds) before it navigates.

## Edge runtimes

The entry loads without a DOM on Cloudflare Workers and Vercel Edge. The
`@zitadel/components` import resolves to a build without elements on the edge,
so registering them is a no-op there, and `Dynamic` means nothing is compiled
against a DOM at load time. On the server the three components render the
custom element tags with their attributes, as described above; the widgets
themselves do not run there. The package's edge spec loads the built entry in
Vercel's `edge-runtime` VM, renders all three widgets and checks the locale
data is intact. If your app renders on the server, mount the widget on the
client after hydration, or pass `projectId` and `proxyPath` as strings so the
attributes are in the markup, because a widget that starts before its
configuration arrives shows an error instead of the flow.

## Where to go next

- The [README](https://github.com/zitadel/nextgen/tree/main/packages/sdk-solid#readme)
  has installation, the full prop and event tables and the proxy notes.
- Start with {@link ZitadelLogin}, then {@link ZitadelSession} and
  {@link ZitadelLogout}, and {@link configureZitadel} for the project handle.
