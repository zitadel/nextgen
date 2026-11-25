import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

// Registers <zitadel-login>, <zitadel-logout> and <zitadel-session> in the browser.
// The edge build of the components package has no elements, so this does nothing there.
import "@zitadel/components";
import * as Solid from "solid-js";

import { standardAttributes, widgetTags } from "@zitadel/sdk-core/types";
import {
  configureZitadel,
  getApi,
  getZitadelConfig,
  type ZitadelConfig,
  type ZitadelProject,
} from "@zitadel/api/config";

import type {
  ZitadelLoginProps,
  ZitadelLogoutProps,
  ZitadelSessionProps,
  ZitadelWidgetAttributes,
} from "./types.js";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      [widgetTags.login]: Omit<HTMLAttributes<HTMLElement>, "ref"> & {
        ref?: ZitadelLoginElement | ((el: ZitadelLoginElement) => void);
        "prop:project"?: ZitadelProject;
        "prop:locales"?: Record<string, Partial<Record<string, string>>>;
        "prop:lang"?: string;
        "project-id"?: string;
        "proxy-path"?: string;
        url?: string;
        purpose?: string;
        "flow-name"?: string;
        "post-sign-in-url"?: string;
        "prop:forcePostSignInUrl"?: boolean;
        variant?: "widget" | "page";
        theme?: "light" | "dark" | "auto";
        "prop:suppressHeader"?: boolean;
        "prop:suppressPasswordToggle"?: boolean;
      };
      [widgetTags.logout]: Omit<HTMLAttributes<HTMLElement>, "ref"> & {
        ref?: ZitadelLogoutElement | ((el: ZitadelLogoutElement) => void);
        "prop:project"?: ZitadelProject;
        "project-id"?: string;
        "proxy-path"?: string;
        url?: string;
        "post-sign-out-url"?: string;
        theme?: "light" | "dark" | "auto";
      };
      [widgetTags.session]: Omit<HTMLAttributes<HTMLElement>, "ref"> & {
        ref?: ZitadelSessionElement | ((el: ZitadelSessionElement) => void);
        "prop:project"?: ZitadelProject;
        "project-id"?: string;
        "proxy-path"?: string;
        url?: string;
        "post-sign-out-url"?: string;
        heading?: string;
        "logout-label"?: string;
        variant?: "widget" | "page";
        theme?: "light" | "dark" | "auto";
        "prop:suppressHeader"?: boolean;
      };
    }
  }
}

/**
 * The project coordinates as attributes, so they are in the server markup. The
 * `project` handle stays a property too (it carries the publishable key and is
 * what the element prefers once Solid hydrates); its fields win over the
 * discrete props, as they do inside the widget. An empty proxy path is written
 * as `/`: the widget treats an empty `proxy-path` attribute as unset and falls
 * back to its default, while `/` normalizes to the site root.
 */
function projectAttributes(props: {
  readonly project?: ZitadelProject;
  readonly projectId?: string;
  readonly proxyPath?: string;
}) {
  const proxyPath = props.project?.proxyPath ?? props.proxyPath;
  return {
    "project-id": props.project?.projectId ?? props.projectId,
    "proxy-path": proxyPath === "" ? "/" : proxyPath,
    url: props.project?.url,
  };
}

/**
 * The prefix Solid needs on an attribute it would otherwise set as a property on
 * a custom element: Solid 1 takes `attr:`, Solid 2 dropped the namespace and
 * sets a plain name as an attribute. Solid 2 is the one that exports
 * `onSettled`.
 */
const ATTRIBUTE_PREFIX = "onSettled" in Solid ? "" : "attr:";

/**
 * Listens for a widget event on its element, and forwards the event's detail to
 * the app callback, registering the callback's returned promise — from an async
 * handler or a Qwik QRL — on the detail's `waitUntil`. The three navigating
 * events (flow-complete, flow-redirect, signout) then wait for it before the
 * widget navigates; other events carry no `waitUntil`, so the call is a no-op.
 *
 * A listener on the element works the same on every Solid, where the `on:` and
 * `onEvent` JSX syntaxes differ between Solid 1 and 2.
 *
 * @param element the widget element
 * @param events the event names, each with a getter for its current callback
 */
function listen(
  element: HTMLElement,
  events: Readonly<Record<string, () => ((detail: never) => unknown) | undefined>>,
): void {
  for (const [name, callback] of Object.entries(events)) {
    element.addEventListener(name, (event) => {
      const handler = callback();
      if (!(event instanceof CustomEvent) || !handler) {
        return;
      }
      const result = (handler as (detail: unknown) => unknown)(event.detail);
      event.detail.waitUntil?.(result);
    });
  }
}

/**
 * Hands the element to the `ref` the app passed, once the widget's listeners are
 * on it.
 */
function forwardRef<Element extends HTMLElement>(
  element: Element,
  ref: ((el: Element) => void) | Element | undefined,
): void {
  if (typeof ref === "function") {
    ref(element);
  }
}

/** Props of `ZitadelLogin`: the widget's own plus the standard HTML attributes. */
export type ZitadelLoginSolidProps = ZitadelLoginProps &
  ZitadelWidgetAttributes & {
    ref?: ZitadelLoginElement | ((el: ZitadelLoginElement) => void);
  };

/** Props of `ZitadelLogout`: the widget's own plus the standard HTML attributes. */
export type ZitadelLogoutSolidProps = ZitadelLogoutProps &
  ZitadelWidgetAttributes & {
    ref?: ZitadelLogoutElement | ((el: ZitadelLogoutElement) => void);
  };

/** Props of `ZitadelSession`: the widget's own plus the standard HTML attributes. */
export type ZitadelSessionSolidProps = ZitadelSessionProps &
  ZitadelWidgetAttributes & {
    ref?: ZitadelSessionElement | ((el: ZitadelSessionElement) => void);
  };

export { configureZitadel, getApi, getZitadelConfig };
export type { ZitadelConfig, ZitadelProject };
export * from "./types.js";

// Re-exported so scaffolded apps can wire the business copy overlay without a
// direct @zitadel/components dependency (strict package managers reject those).
export { businessLocales } from "@zitadel/components";

/**
 * Solid component wrapping the `<zitadel-login>` web component. Binds the
 * {@link ZitadelProject} handle as a DOM property (or the discrete project id /
 * proxy path as attributes) and forwards the widget's `zitadel-*` events as
 * optional callbacks.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-login>` DOM element,
 * so consumers can imperatively access the upgraded web component.
 */
export function ZitadelLogin(props: ZitadelLoginSolidProps): HTMLElement {
  // The standard HTML attributes are the only extra props the element takes.
  // Solid would assign them to a custom element as properties, so they take the
  // prefix the installed Solid needs.
  const attributes = () => standardAttributes(props, ATTRIBUTE_PREFIX);
  return (
    <zitadel-login
      ref={(element: ZitadelLoginElement) => {
        listen(element, {
          "zitadel-flow-step": () => props.onFlowStep,
          "zitadel-flow-input": () => props.onFlowInput,
          "zitadel-flow-complete": () => props.onFlowComplete,
          "zitadel-flow-redirect": () => props.onFlowRedirect,
          "zitadel-flow-error": () => props.onFlowError,
        });
        forwardRef(element, props.ref);
      }}
      {...attributes()}
      prop:project={props.project}
      prop:locales={props.locales}
      prop:lang={props.lang}
      {...projectAttributes(props)}
      purpose={props.purpose ?? "login"}
      flow-name={props.flowName}
      post-sign-in-url={props.postSignInUrl}
      prop:forcePostSignInUrl={props.forcePostSignInUrl}
      resume-flow-id={props.resumeFlowId}
      variant={props.variant}
      theme={props.theme}
      prop:suppressHeader={props.suppressHeader}
      prop:suppressPasswordToggle={props.suppressPasswordToggle}
    />
  ) as HTMLElement;
}

/**
 * Solid component wrapping the `<zitadel-logout>` web component. Binds the
 * {@link ZitadelProject} handle as a DOM property (or the discrete project id /
 * proxy path as attributes) and forwards the widget's `zitadel-signout` event
 * as an optional callback.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-logout>` DOM element,
 * so consumers can imperatively access the upgraded web component.
 */
export function ZitadelLogout(props: ZitadelLogoutSolidProps): HTMLElement {
  // The standard HTML attributes are the only extra props the element takes.
  // Solid would assign them to a custom element as properties, so they take the
  // prefix the installed Solid needs.
  const attributes = () => standardAttributes(props, ATTRIBUTE_PREFIX);
  return (
    <zitadel-logout
      ref={(element: ZitadelLogoutElement) => {
        listen(element, {
          "zitadel-signout": () => props.onSignout,
        });
        forwardRef(element, props.ref);
      }}
      {...attributes()}
      prop:project={props.project}
      {...projectAttributes(props)}
      post-sign-out-url={props.postSignOutUrl}
      theme={props.theme}
    />
  ) as HTMLElement;
}

/**
 * Solid component wrapping the `<zitadel-session>` web component — the
 * post-sign-in "signed in as" card. Binds the {@link ZitadelProject} handle as
 * a DOM property (or the discrete project id / proxy path as attributes) and
 * forwards the widget's `zitadel-signout` event as an optional callback.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-session>` DOM element.
 */
export function ZitadelSession(props: ZitadelSessionSolidProps): HTMLElement {
  // The standard HTML attributes are the only extra props the element takes.
  // Solid would assign them to a custom element as properties, so they take the
  // prefix the installed Solid needs.
  const attributes = () => standardAttributes(props, ATTRIBUTE_PREFIX);
  return (
    <zitadel-session
      ref={(element: ZitadelSessionElement) => {
        listen(element, {
          "zitadel-signout": () => props.onSignout,
        });
        forwardRef(element, props.ref);
      }}
      {...attributes()}
      prop:project={props.project}
      {...projectAttributes(props)}
      post-sign-out-url={props.postSignOutUrl}
      heading={props.heading}
      logout-label={props.logoutLabel}
      variant={props.variant}
      theme={props.theme}
      prop:suppressHeader={props.suppressHeader}
    />
  ) as HTMLElement;
}
