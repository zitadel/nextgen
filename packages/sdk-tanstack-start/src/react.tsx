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
// Every type `@zitadel/sdk-react` exports. A TanStack Start app installs only
// this package, so under a strict package manager it cannot import
// `@zitadel/sdk-react` to type a widget callback.
//
// The list is explicit because tsup's declaration bundler rewrites
// `export type * from` into a plain `export *`, which would declare
// sdk-react's runtime exports (`configureZitadel`, ...) on this entry without
// shipping them. react.test.tsx fails when this list and sdk-react's drift.
export type {
  CreateFlowBodyPurpose,
  isStandardAttributeName,
  StandardAttributeName,
  StandardAttributeProps,
  StandardAttributes,
  standardAttributes,
  WidgetName,
  widgetNames,
  WidgetTag,
  widgetTags,
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGIN_EVENTS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENTS,
  ZITADEL_SESSION_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENTS,
  ZitadelConfig,
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowStepDetail,
  ZitadelLoginConfig,
  ZitadelLoginEventMap,
  ZitadelLoginHandlers,
  ZitadelLoginProps,
  ZitadelLoginReactProps,
  ZitadelLogoutConfig,
  ZitadelLogoutEventMap,
  ZitadelLogoutHandlers,
  ZitadelLogoutProps,
  ZitadelLogoutReactProps,
  ZitadelProject,
  ZitadelSessionConfig,
  ZitadelSessionErrorDetail,
  ZitadelSessionEventMap,
  ZitadelSessionHandlers,
  ZitadelSessionProps,
  ZitadelSessionReactProps,
  ZitadelSignoutDetail,
  ZitadelWidgetAttributes,
} from "@zitadel/sdk-react";

const subscribeNever = () => () => {};

/**
 * `false` on the server and while React hydrates, `true` from the first client
 * render after that (and on any render that is not a hydration).
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

function clientOnly<P, R>(Component: Widget<P, R>, displayName: string): Widget<P, R> {
  const ClientOnlyWidget = React.forwardRef<R, P>(function ClientOnlyWidget(props, ref) {
    return useHydrated() ? <Component {...props} ref={ref} /> : null;
  });
  ClientOnlyWidget.displayName = displayName;
  return ClientOnlyWidget;
}

/** `@zitadel/sdk-react`'s `ZitadelLogin`, mounted only on the client. */
export const ZitadelLogin: typeof ReactZitadelLogin = clientOnly(ReactZitadelLogin, "ZitadelLogin");

/** `@zitadel/sdk-react`'s `ZitadelLogout`, mounted only on the client. */
export const ZitadelLogout: typeof ReactZitadelLogout = clientOnly(
  ReactZitadelLogout,
  "ZitadelLogout",
);

/** `@zitadel/sdk-react`'s `ZitadelSession`, mounted only on the client. */
export const ZitadelSession: typeof ReactZitadelSession = clientOnly(
  ReactZitadelSession,
  "ZitadelSession",
);
