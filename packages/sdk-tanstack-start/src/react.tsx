"use client";

/**
 * React components for the Zitadel auth widgets — `@zitadel/sdk-react`'s, so a
 * TanStack Start app gets exactly the wrappers a React app does (every event,
 * `children` slots, the session card) and the two can never drift apart.
 *
 * They wrap the Lit web components from `@zitadel/components` with
 * `@lit/react`: the SDK `project` handle is bound as a DOM property and the
 * widget's `zitadel-*` events surface as typed callbacks.
 *
 * TanStack Start server-renders every route, and `@lit/react` emits a bare tag
 * with none of the props on the server. The browser defines the elements before
 * React hydrates, so a server-rendered `<zitadel-login>` would upgrade with the
 * element defaults (purpose `login`, no project) and start a flow before
 * hydration applies the real props. Each component here therefore renders
 * nothing on the server and during hydration, and mounts the widget right after,
 * with every prop in place before the element starts its flow. On a client-side
 * navigation it mounts at once.
 */
import {
  ZitadelLogin as ReactZitadelLogin,
  ZitadelLogout as ReactZitadelLogout,
  ZitadelSession as ReactZitadelSession,
} from "@zitadel/sdk-react";
import * as React from "react";
// Registers <zitadel-login>, <zitadel-logout> and <zitadel-session> in the browser.
// The edge build of the components package has no elements, so this does nothing there.
import "@zitadel/components";

// Re-exported so scaffolded apps can wire the business copy overlay without a
// direct @zitadel/components dependency (strict package managers reject those).
export { businessLocales } from "@zitadel/components";
// The types a widget callback or prop needs. A TanStack Start app installs only
// this package, so under a strict package manager it cannot import
// `@zitadel/sdk-react` to type them.
//
// The list is explicit, and names only the public set, because tsup's
// declaration bundler rewrites `export type * from` into a plain `export *`,
// which would declare sdk-react's runtime exports (`configureZitadel`, ...) on
// this entry without shipping them. react.test.tsx fails when a name here is
// not exported by sdk-react.
export type {
  CreateFlowBodyPurpose,
  ZitadelConfig,
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowStepDetail,
  ZitadelLoginConfig,
  ZitadelLoginHandlers,
  ZitadelLoginProps,
  ZitadelLoginReactProps,
  ZitadelLogoutConfig,
  ZitadelLogoutHandlers,
  ZitadelLogoutProps,
  ZitadelLogoutReactProps,
  ZitadelNavigationDetail,
  ZitadelProject,
  ZitadelSessionConfig,
  ZitadelSessionHandlers,
  ZitadelSessionProps,
  ZitadelSessionReactProps,
  ZitadelSignoutDetail,
  ZitadelWidgetAttributes,
} from "@zitadel/sdk-react";

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

type Widget<P, R> = React.ForwardRefExoticComponent<
  React.PropsWithoutRef<P> & React.RefAttributes<R>
>;

/**
 * Wraps a widget component so it renders nothing on the server and during
 * hydration, and mounts right after with every prop in place.
 *
 * @param Component - The `@zitadel/sdk-react` widget to wrap.
 * @param displayName - The name React DevTools and warnings show for the wrapper.
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
 * The sign-in and sign-up widget, mounted on the client only.
 *
 * It is `@zitadel/sdk-react`'s `ZitadelLogin` with the same props, events and
 * ref, wrapped so it renders nothing on the server and during hydration. A
 * server-rendered `<zitadel-login>` would upgrade with the element defaults
 * (purpose `login`, no project) and start a flow before hydration applied the
 * real props; mounting after hydration gives the element every prop before it
 * starts its flow. On a client-side navigation it mounts at once.
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
 * The sign-out control, mounted on the client only.
 *
 * It is `@zitadel/sdk-react`'s `ZitadelLogout` with the same props, events and
 * ref, wrapped so it renders nothing on the server and during hydration, for
 * the same reason as {@link ZitadelLogin}: the element must not upgrade with
 * its defaults before the real props arrive.
 */
export const ZitadelLogout: typeof ReactZitadelLogout = clientOnly(
  ReactZitadelLogout,
  "ZitadelLogout",
);

/**
 * The "signed in as" card with a sign-out button, mounted on the client only.
 *
 * It is `@zitadel/sdk-react`'s `ZitadelSession` with the same props, events and
 * ref, wrapped so it renders nothing on the server and during hydration, for
 * the same reason as {@link ZitadelLogin}. When it finds no session it
 * navigates to its `postSignOutUrl`, which also makes it a guard on client-side
 * navigation.
 */
export const ZitadelSession: typeof ReactZitadelSession = clientOnly(
  ReactZitadelSession,
  "ZitadelSession",
);
