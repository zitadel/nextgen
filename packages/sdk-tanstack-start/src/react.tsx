"use client";

/**
 * The React components for the sign-in, sign-out and session widgets, for TanStack Start apps.
 *
 * They are the components of `@zitadel/sdk-react`, so a TanStack Start app gets exactly the
 * wrappers a React app does (every event, the `children` slots, the session card), and the two
 * can never drift apart. Those components wrap the web components from `@zitadel/components`
 * with `@lit/react`: the project handle is bound as a DOM property and the widget's `zitadel-*`
 * events surface as typed callbacks.
 *
 * TanStack Start server-renders every route, and `@lit/react` emits a bare tag with none of the
 * props on the server. The browser defines the elements before React hydrates, so a
 * server-rendered `<zitadel-login>` would upgrade with the element defaults (purpose `login`,
 * no project) and start a flow before hydration applies the real props. Each component here
 * therefore renders nothing on the server and during hydration, and mounts the widget right
 * after, with every prop in place before the element starts its flow. On a client-side
 * navigation it mounts at once. The edge build of `@zitadel/components` defines no elements, so
 * importing this entry on an edge runtime is safe. An element that must not upgrade early is the reason the components are not rendered
 * as a bare server tag: a widget that starts its flow with defaults could not be corrected
 * afterwards.
 *
 * @module
 */
import {
  ZitadelLogin as ReactZitadelLogin,
  ZitadelLogout as ReactZitadelLogout,
  ZitadelSession as ReactZitadelSession,
} from "@zitadel/sdk-react";
import * as React from "react";
/*
 * Registers <zitadel-login>, <zitadel-logout> and <zitadel-session> in the browser.
 * The edge build of the components package has no elements, so this does nothing there.
 */
import "@zitadel/components";

/*
 * Re-exported so scaffolded apps can wire the business copy overlay without a
 * direct @zitadel/components dependency (strict package managers reject those).
 */
export { businessLocales } from "@zitadel/components";
/*
 * The types a widget callback or prop needs. A TanStack Start app installs only this package,
 * so under a strict package manager it cannot import `@zitadel/sdk-react` to type them.
 *
 * The list is explicit, because nothing in the public API is re-exported by barrel. It must
 * also never become `export type * from "@zitadel/sdk-react"`: tsup's declaration bundler
 * rewrites `export type * from` into a plain `export *`, which would declare sdk-react's
 * runtime exports (such as `configureZitadel`) on this entry without shipping them. The test
 * in `react.test.tsx` fails when a name listed here is not exported by sdk-react.
 */
export type {
  ZitadelFlowPurpose,
  ZitadelFlowStep,
  ZitadelFlowBehavior,
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowStepDetail,
  ZitadelLoginProps,
  ZitadelLogoutProps,
  ZitadelSessionProps,
  ZitadelSignoutDetail,
} from "@zitadel/sdk-react";

/**
 * Subscribes to nothing.
 *
 * The hydration check reads a value that never changes after hydration, so there is no store to
 * subscribe to.
 *
 * @returns A function that unsubscribes, which does nothing.
 */
const subscribeNever = () => () => {};

/**
 * Tells a component whether it is past hydration.
 *
 * React treats the server snapshot as the value to hydrate against, so this is
 * `false` on the server and during hydration, which keeps the first client
 * render identical to the server markup. It becomes `true` right after, and is
 * `true` at once on any render that is not a hydration, such as a client-side
 * navigation.
 *
 * @returns `false` on the server and while React hydrates, `true` otherwise.
 */
function useHydrated(): boolean {
  return React.useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/**
 * The type of a forwarded-ref widget component.
 *
 * @typeParam P - The props the component accepts.
 * @typeParam R - The element type that the forwarded `ref` points to.
 */
type Widget<P, R> = React.ForwardRefExoticComponent<
  React.PropsWithoutRef<P> & React.RefAttributes<R>
>;

/**
 * Wraps a widget component so it renders nothing on the server and during
 * hydration, and mounts right after with every prop in place.
 *
 * @typeParam P - The props the widget accepts.
 * @typeParam R - The element type that the forwarded `ref` points to.
 * @param Component - The `@zitadel/sdk-react` widget to wrap.
 * @param displayName - The name that React DevTools and warnings show for the wrapper.
 * @returns A component that forwards its props and ref to `Component` once hydrated.
 */
function clientOnly<P, R>(Component: Widget<P, R>, displayName: string): Widget<P, R> {
  const ClientOnlyWidget = React.forwardRef<R, P>(function ClientOnlyWidget(props, ref) {
    return useHydrated() ? <Component {...props} ref={ref} /> : null;
  });
  ClientOnlyWidget.displayName = displayName;
  return ClientOnlyWidget;
}

/**
 * Renders the sign-in and sign-up widget, mounted on the client only.
 *
 * It is the `ZitadelLogin` component of `@zitadel/sdk-react` with the same props, events and
 * ref, wrapped so that it renders nothing on the server and during hydration. A server-rendered
 * `<zitadel-login>` would upgrade with the element defaults (purpose `login`, no project) and
 * start a flow before hydration applied the real props. Mounting after hydration gives the
 * element every prop before it starts its flow. On a client-side navigation it mounts at once.
 *
 * Use it on the login and register pages, with the project handle from
 * {@link client!configureZitadel}. The widget talks to the backend through the same-origin
 * proxy path that {@link server!createNextgenMiddleware} serves, so register the middleware
 * first. The widget returns to the protected route that sent the visitor to the login page,
 * following `next` only when it is a path on the page's own origin. It also accepts the
 * standard HTML attributes (`class`, `style`, `id`, `aria-*`, `data-*` and similar), and no
 * other extra props reach the element. The server response contains the page without the widget, which appears after
 * hydration.
 *
 * @example
 * ```tsx
 * import { ZitadelLogin } from "@zitadel/sdk-tanstack-start/react";
 * import { configureZitadel } from "@zitadel/sdk-tanstack-start/client";
 *
 * const project = configureZitadel({ projectId: "demo", proxyPath: "/__nextgen" });
 *
 * export function LoginPage() {
 *   return <ZitadelLogin project={project} purpose="login" postSignInUrl="/admin" />;
 * }
 * ```
 */
export const ZitadelLogin: typeof ReactZitadelLogin = clientOnly(ReactZitadelLogin, "ZitadelLogin");

/**
 * Renders the sign-out control, mounted on the client only.
 *
 * It is the `ZitadelLogout` component of `@zitadel/sdk-react` with the same props, events and
 * ref, wrapped so that it renders nothing on the server and during hydration, for the same
 * reason as {@link ZitadelLogin}: the element must not upgrade with its defaults before the
 * real props arrive. Use it for a sign-out control on its own, and use {@link ZitadelSession}
 * when the page also shows who is signed in.
 *
 * @example
 * ```tsx
 * import { ZitadelLogout } from "@zitadel/sdk-tanstack-start/react";
 * import { configureZitadel } from "@zitadel/sdk-tanstack-start/client";
 *
 * const project = configureZitadel({ projectId: "demo", proxyPath: "/__nextgen" });
 *
 * export function SignOut() {
 *   return <ZitadelLogout project={project} postSignOutUrl="/login" />;
 * }
 * ```
 */
export const ZitadelLogout: typeof ReactZitadelLogout = clientOnly(
  ReactZitadelLogout,
  "ZitadelLogout",
);

/**
 * Renders the "signed in as" card with a sign-out button, mounted on the client only.
 *
 * It is the `ZitadelSession` component of `@zitadel/sdk-react` with the same props, events and
 * ref, wrapped so that it renders nothing on the server and during hydration, for the same
 * reason as {@link ZitadelLogin}. Use it on a profile page. When it finds no session it
 * navigates to its `postSignOutUrl`, which also makes it a guard on client-side navigation. The
 * server-side guard is still the middleware, because this component runs only in the browser.
 *
 * @example
 * ```tsx
 * import { ZitadelSession } from "@zitadel/sdk-tanstack-start/react";
 * import { configureZitadel } from "@zitadel/sdk-tanstack-start/client";
 *
 * const project = configureZitadel({ projectId: "demo", proxyPath: "/__nextgen" });
 *
 * export function Profile() {
 *   return <ZitadelSession project={project} postSignOutUrl="/login" />;
 * }
 * ```
 */
export const ZitadelSession: typeof ReactZitadelSession = clientOnly(
  ReactZitadelSession,
  "ZitadelSession",
);
