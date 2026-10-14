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
  ZitadelFlowRedirectDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowStepDetail,
  ZitadelLoginProps,
  ZitadelLogoutProps,
  ZitadelSessionErrorDetail,
  ZitadelSessionMissingDetail,
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
    onZitadelFlowRedirect: "zitadel-flow-redirect" as EventName<
      CustomEvent<ZitadelFlowRedirectDetail>
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
    onZitadelSessionMissing: "zitadel-session-missing" as EventName<
      CustomEvent<ZitadelSessionMissingDetail>
    >,
    onZitadelSessionError: "zitadel-session-error" as EventName<
      CustomEvent<ZitadelSessionErrorDetail>
    >,
  },
});

const ZitadelSessionElementReact = createComponent({
  react: React,
  tagName: "zitadel-session",
  elementClass: ZitadelSessionElement,
  events: {
    onZitadelSignout: "zitadel-signout" as EventName<CustomEvent<ZitadelSignoutDetail>>,
    onZitadelSessionMissing: "zitadel-session-missing" as EventName<
      CustomEvent<ZitadelSessionMissingDetail>
    >,
    onZitadelSessionError: "zitadel-session-error" as EventName<
      CustomEvent<ZitadelSessionErrorDetail>
    >,
  },
});

/**
 * React component wrapping the `<zitadel-login>` web component. Binds the
 * `ZitadelProject` handle (and every other prop) as a DOM property and forwards the widget's `zitadel-*` events as
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
export type ZitadelLoginReactProps = ZitadelLoginProps & {
  children?: React.ReactNode;
  /**
   * Preview mode, for an operator surface: the flow starts as usual, then the
   * element shows the served step in this state and submits nothing.
   */
  previewState?: ZitadelLoginElement["previewState"];
  /** The terminal step the `success` preview paints; the element's `done` when unset. */
  previewSuccessStep?: string;
};

export const ZitadelLogin = React.forwardRef<ZitadelLoginElement, ZitadelLoginReactProps>(
  function ZitadelLogin(
    { onFlowStep, onFlowInput, onFlowComplete, onFlowRedirect, onFlowError, ...props },
    ref,
  ) {
    // Props are forwarded as given: an unset or cleared one reaches the
    // element as `undefined`, which the element reads as its default.
    return (
      <ZitadelLoginElementReact
        {...props}
        ref={ref}
        onZitadelFlowStep={onFlowStep && ((event) => onFlowStep(event.detail))}
        onZitadelFlowInput={onFlowInput && ((event) => onFlowInput(event.detail))}
        onZitadelFlowComplete={onFlowComplete && ((event) => onFlowComplete(event.detail))}
        onZitadelFlowRedirect={onFlowRedirect && ((event) => onFlowRedirect(event.detail))}
        onZitadelFlowError={onFlowError && ((event) => onFlowError(event.detail))}
      />
    );
  },
);

ZitadelLogin.displayName = "ZitadelLogin";

/**
 * React component wrapping the `<zitadel-logout>` web component. Binds the
 * `ZitadelProject` handle (and every other prop) as a DOM property and forwards the widget's `zitadel-signout`,
 * `zitadel-session-missing` and `zitadel-session-error` events as optional callbacks.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-logout>` DOM element,
 * so consumers can imperatively access the upgraded web component.
 */
/**
 * `ZitadelLogoutProps` carries no `children`; React hosts pass the
 * `<template>` the element clones into its light DOM for a custom menu.
 */
export type ZitadelLogoutReactProps = ZitadelLogoutProps & { children?: React.ReactNode };

export const ZitadelLogout = React.forwardRef<ZitadelLogoutElement, ZitadelLogoutReactProps>(
  function ZitadelLogout({ onSignout, onSessionMissing, onSessionError, ...props }, ref) {
    return (
      <ZitadelLogoutElementReact
        {...props}
        ref={ref}
        onZitadelSignout={onSignout && ((event) => onSignout(event.detail))}
        onZitadelSessionMissing={onSessionMissing && ((event) => onSessionMissing(event.detail))}
        onZitadelSessionError={onSessionError && ((event) => onSessionError(event.detail))}
      />
    );
  },
);

ZitadelLogout.displayName = "ZitadelLogout";

/**
 * React component wrapping the `<zitadel-session>` web component — the
 * post-sign-in "signed in as" card. Binds the `ZitadelProject` handle (and every
 * other prop) as a DOM property and forwards the widget's `zitadel-signout`, `zitadel-session-missing`
 * and `zitadel-session-error` events as optional callbacks.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-session>` DOM element.
 */
/** `ZitadelSessionProps` plus `children`, forwarded into the element's light DOM. */
export type ZitadelSessionReactProps = ZitadelSessionProps & { children?: React.ReactNode };

export const ZitadelSession = React.forwardRef<ZitadelSessionElement, ZitadelSessionReactProps>(
  function ZitadelSession({ onSignout, onSessionMissing, onSessionError, ...props }, ref) {
    return (
      <ZitadelSessionElementReact
        {...props}
        ref={ref}
        onZitadelSignout={onSignout && ((event) => onSignout(event.detail))}
        onZitadelSessionMissing={onSessionMissing && ((event) => onSessionMissing(event.detail))}
        onZitadelSessionError={onSessionError && ((event) => onSessionError(event.detail))}
      />
    );
  },
);

ZitadelSession.displayName = "ZitadelSession";
