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

/**
 * The session widgets report a failed load or sign-out as soon as they start,
 * which can be before React's layout effects run. `@lit/react` registers its
 * `events` listeners in such an effect, so an event raised while the element
 * mounts would be lost. This callback ref registers the listeners at attach
 * time instead, before the element can start loading, and reads the handlers
 * at event time so a re-render never has to re-register them.
 */
function useSessionEvents<T extends HTMLElement>(
  handlers: {
    onSignout?: ZitadelSessionProps["onSignout"];
    onSessionError?: ZitadelSessionProps["onSessionError"];
  },
  forwardedRef: React.ForwardedRef<T>,
): React.RefCallback<T> {
  const latest = React.useRef(handlers);
  latest.current = handlers;
  const dispose = React.useRef<(() => void) | undefined>(undefined);
  return React.useCallback(
    (el: T | null) => {
      dispose.current?.();
      dispose.current = undefined;
      if (el) {
        const onSignout = (event: Event) =>
          latest.current.onSignout?.((event as CustomEvent<ZitadelSignoutDetail>).detail);
        const onSessionError = (event: Event) =>
          latest.current.onSessionError?.((event as CustomEvent<ZitadelSessionErrorDetail>).detail);
        el.addEventListener("zitadel-signout", onSignout);
        el.addEventListener("zitadel-session-error", onSessionError);
        dispose.current = () => {
          el.removeEventListener("zitadel-signout", onSignout);
          el.removeEventListener("zitadel-session-error", onSessionError);
        };
      }
      if (typeof forwardedRef === "function") {
        forwardedRef(el);
      } else if (forwardedRef) {
        forwardedRef.current = el;
      }
    },
    [forwardedRef],
  );
}

const ZitadelLogoutElementReact = createComponent({
  react: React,
  tagName: "zitadel-logout",
  elementClass: ZitadelLogoutElement,
});

const ZitadelSessionElementReact = createComponent({
  react: React,
  tagName: "zitadel-session",
  elementClass: ZitadelSessionElement,
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
 * proxy path as attributes) and forwards the widget's `zitadel-signout` and
 * `zitadel-session-error` events as optional callbacks.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-logout>` DOM element,
 * so consumers can imperatively access the upgraded web component.
 */
export const ZitadelLogout = React.forwardRef<ZitadelLogoutElement, ZitadelLogoutProps>(
  function ZitadelLogout({ onSignout, onSessionError, ...props }, ref) {
    const elementRef = useSessionEvents({ onSignout, onSessionError }, ref);
    return <ZitadelLogoutElementReact {...props} ref={elementRef} />;
  },
);

ZitadelLogout.displayName = "ZitadelLogout";

/**
 * React component wrapping the `<zitadel-session>` web component — the
 * post-sign-in "signed in as" card. Binds the `ZitadelProject` handle as a DOM
 * property (or the discrete project id / proxy path as attributes) and forwards
 * the widget's `zitadel-signout` and `zitadel-session-error` events as optional
 * callbacks.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-session>` DOM element.
 */
export const ZitadelSession = React.forwardRef<ZitadelSessionElement, ZitadelSessionProps>(
  function ZitadelSession({ onSignout, onSessionError, ...props }, ref) {
    const elementRef = useSessionEvents({ onSignout, onSessionError }, ref);
    return <ZitadelSessionElementReact {...props} ref={elementRef} />;
  },
);

ZitadelSession.displayName = "ZitadelSession";
