import { createComponent, type EventName } from "@lit/react";
import {
  configureZitadel,
  getApi,
  getZitadelConfig,
  type ZitadelConfig,
  type ZitadelProject,
} from "@zitadel/api/config";
import {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";
import * as React from "react";

import type {
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowStepDetail,
  ZitadelLoginProps,
  ZitadelLogoutProps,
  ZitadelSessionProps,
  ZitadelSignoutDetail,
} from "./types";

export { configureZitadel, getApi, getZitadelConfig };
export type { ZitadelConfig, ZitadelProject };
export * from "./types";

// Re-exported so scaffolded apps can wire the business copy overlay without a
// direct @zitadel/components dependency (strict package managers reject those).
export { businessLocales } from "@zitadel/components";

/**
 * React components for the Zitadel auth widgets.
 *
 * These wrap the framework-agnostic Lit web components from
 * `@zitadel/components` with `@lit/react`'s `createComponent`, so they are real
 * React components: the SDK `project` handle is bound as a DOM *property* (not
 * an attribute) — which is what the elements read at startup — and the widget's
 * `zitadel-*` events are registered as element listeners via the `events` map
 * and surfaced as optional callbacks receiving the event detail.
 *
 * In a client-side SPA, build the handle with `configureZitadel(...)` and pass
 * it as the `project` prop. Because the SPA renders after configuration, the
 * prop is present when the element upgrades:
 *
 * ```tsx
 * import { ZitadelLogin, configureZitadel } from "@zitadel/sdk-react";
 *
 * const project = configureZitadel({ projectId: "…", proxyPath: "/__nextgen" });
 *
 * export function LoginPage() {
 *   return <ZitadelLogin project={project} purpose="login" postSignInUrl="/" />;
 * }
 * ```
 */
const ZitadelLoginElementReact = createComponent({
  react: React,
  tagName: "zitadel-login",
  elementClass: ZitadelLoginElement,
  events: {
    onZitadelFlowStep: "zitadel-flow-step" as EventName<CustomEvent<ZitadelFlowStepDetail>>,
    onZitadelFlowInput: "zitadel-flow-input" as EventName<CustomEvent<ZitadelFlowInputDetail>>,
    onZitadelFlowComplete: "zitadel-flow-complete" as EventName<
      CustomEvent<ZitadelFlowCompleteDetail>
    >,
    onZitadelFlowError: "zitadel-flow-error" as EventName<CustomEvent<ZitadelFlowErrorDetail>>,
  },
});

const ZitadelLogoutElementReact = createComponent({
  react: React,
  tagName: "zitadel-logout",
  elementClass: ZitadelLogoutElement,
  events: {
    onZitadelSignout: "zitadel-signout" as EventName<CustomEvent<ZitadelSignoutDetail>>,
  },
});

const ZitadelSessionElementReact = createComponent({
  react: React,
  tagName: "zitadel-session",
  elementClass: ZitadelSessionElement,
  events: {
    onZitadelSignout: "zitadel-signout" as EventName<CustomEvent<ZitadelSignoutDetail>>,
  },
});

/**
 * React component wrapping the `<zitadel-login>` web component. Binds the
 * `ZitadelProject` handle as a DOM property (or the discrete project id /
 * proxy path as attributes) and forwards the widget's `zitadel-*` events as
 * optional callbacks.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-login>` DOM element,
 * so consumers can imperatively access the upgraded web component.
 */
/**
 * `ZitadelLoginProps` is framework-agnostic, so it carries no `children`.
 * React hosts need them: the widget exposes slots (`attribution-trailing`)
 * that are filled with light-DOM content.
 */
export type ZitadelLoginReactProps = ZitadelLoginProps & { children?: React.ReactNode };

export const ZitadelLogin = React.forwardRef<ZitadelLoginElement, ZitadelLoginReactProps>(
  function ZitadelLogin(
    { purpose, onFlowStep, onFlowInput, onFlowComplete, onFlowError, ...props },
    ref,
  ) {
    return (
      <ZitadelLoginElementReact
        {...props}
        ref={ref}
        purpose={purpose ?? "login"}
        onZitadelFlowStep={onFlowStep && ((event) => onFlowStep(event.detail))}
        onZitadelFlowInput={onFlowInput && ((event) => onFlowInput(event.detail))}
        onZitadelFlowComplete={onFlowComplete && ((event) => onFlowComplete(event.detail))}
        onZitadelFlowError={onFlowError && ((event) => onFlowError(event.detail))}
      />
    );
  },
);

ZitadelLogin.displayName = "ZitadelLogin";

/**
 * React component wrapping the `<zitadel-logout>` web component. Binds the
 * `ZitadelProject` handle as a DOM property (or the discrete project id /
 * proxy path as attributes) and forwards the widget's `zitadel-signout` event
 * as an optional callback.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-logout>` DOM element,
 * so consumers can imperatively access the upgraded web component.
 */
export const ZitadelLogout = React.forwardRef<ZitadelLogoutElement, ZitadelLogoutProps>(
  function ZitadelLogout({ onSignout, ...props }, ref) {
    return (
      <ZitadelLogoutElementReact
        {...props}
        ref={ref}
        onZitadelSignout={onSignout && ((event) => onSignout(event.detail))}
      />
    );
  },
);

ZitadelLogout.displayName = "ZitadelLogout";

/**
 * React component wrapping the `<zitadel-session>` web component — the
 * post-sign-in "signed in as" card. Binds the `ZitadelProject` handle as a DOM
 * property (or the discrete project id / proxy path as attributes) and forwards
 * the widget's `zitadel-signout` event as an optional callback.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-session>` DOM element.
 */
export const ZitadelSession = React.forwardRef<ZitadelSessionElement, ZitadelSessionProps>(
  function ZitadelSession({ onSignout, ...props }, ref) {
    return (
      <ZitadelSessionElementReact
        {...props}
        ref={ref}
        onZitadelSignout={onSignout && ((event) => onSignout(event.detail))}
      />
    );
  },
);

ZitadelSession.displayName = "ZitadelSession";
