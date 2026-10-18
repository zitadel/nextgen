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
/**
 * `createComponent` binds every key found on the element's prototype as a DOM
 * property, and a property is never written into server markup. The widget
 * starts its first flow when it upgrades, before React hydrates, so the keys
 * that define that flow must reach the browser as attributes. This hides the
 * given keys from that lookup: they are passed through as plain attributes
 * (server markup included) and the element still reads them as properties.
 */
function asAttributes<T extends typeof HTMLElement>(
  elementClass: T,
  ...keys: readonly string[]
): T {
  const hidden = new Set<PropertyKey>(keys);
  const prototype = new Proxy(elementClass.prototype, {
    has: (target, key) => !hidden.has(key) && key in target,
  });
  return { name: elementClass.name, prototype } as unknown as T;
}

/**
 * The project coordinates as attributes, so they are in the server markup. The
 * `project` handle stays a property too: it carries the publishable key and is
 * what the element prefers once React hands it over.
 *
 * A handle with a publishable key writes none: attributes cannot carry the key,
 * so a widget that started from them would send its first request without the
 * bearer the project needs, and never retry. Left unconfigured, it waits for
 * the handle React binds at hydration.
 */
function projectAttributes(props: {
  readonly project?: ZitadelProject;
  readonly projectId?: string;
  readonly proxyPath?: string;
}) {
  if (props.project?.publishableKey) return {};
  return {
    "project-id": props.project?.projectId ?? props.projectId,
    "proxy-path": props.project?.proxyPath ?? props.proxyPath,
    url: props.project?.url,
  };
}

const ZitadelLoginElementReact = createComponent({
  react: React,
  tagName: "zitadel-login",
  elementClass: asAttributes(ZitadelLoginElement, "purpose", "url"),
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
  elementClass: asAttributes(ZitadelLogoutElement, "url"),
  events: {
    onZitadelSignout: "zitadel-signout" as EventName<CustomEvent<ZitadelSignoutDetail>>,
  },
});

const ZitadelSessionElementReact = createComponent({
  react: React,
  tagName: "zitadel-session",
  elementClass: asAttributes(ZitadelSessionElement, "url"),
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
    { purpose, onFlowStep, onFlowInput, onFlowComplete, onFlowRedirect, onFlowError, ...props },
    ref,
  ) {
    return (
      <ZitadelLoginElementReact
        {...props}
        ref={ref}
        purpose={purpose ?? "login"}
        flow-name={props.flowName}
        {...projectAttributes(props)}
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
        {...projectAttributes(props)}
        post-sign-out-url={props.postSignOutUrl}
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
        {...projectAttributes(props)}
        post-sign-out-url={props.postSignOutUrl}
        ref={ref}
        onZitadelSignout={onSignout && ((event) => onSignout(event.detail))}
      />
    );
  },
);

ZitadelSession.displayName = "ZitadelSession";
