import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import "@zitadel/components";
import { createRenderEffect, type JSX } from "solid-js";

import {
  configureZitadel,
  getApi,
  getZitadelConfig,
  type ZitadelConfig,
  type ZitadelProject,
} from "@zitadel/api/config";

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

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "zitadel-login": Omit<HTMLAttributes<HTMLElement>, "ref"> & {
        ref?: ZitadelLoginElement | ((el: ZitadelLoginElement) => void);
        "prop:project"?: ZitadelProject;
        "prop:locales"?: Record<string, Partial<Record<string, string>>>;
        "prop:lang"?: string;
        "project-id"?: string;
        "proxy-path"?: string;
        purpose?: string;
        "flow-name"?: string;
        "post-sign-in-url"?: string;
        variant?: "widget" | "page";
        theme?: "light" | "dark" | "auto";
        "prop:suppressHeader"?: boolean;
        "prop:suppressPasswordToggle"?: boolean;
        "on:zitadel-flow-step"?: (event: CustomEvent<ZitadelFlowStepDetail>) => void;
        "on:zitadel-flow-input"?: (event: CustomEvent<ZitadelFlowInputDetail>) => void;
        "on:zitadel-flow-complete"?: (event: CustomEvent<ZitadelFlowCompleteDetail>) => void;
        "on:zitadel-flow-redirect"?: (event: CustomEvent<ZitadelFlowRedirectDetail>) => void;
        "on:zitadel-flow-error"?: (event: CustomEvent<ZitadelFlowErrorDetail>) => void;
      };
      "zitadel-logout": Omit<HTMLAttributes<HTMLElement>, "ref"> & {
        ref?: ZitadelLogoutElement | ((el: ZitadelLogoutElement) => void);
        "prop:project"?: ZitadelProject;
        "project-id"?: string;
        "proxy-path"?: string;
        "post-sign-out-url"?: string;
        theme?: "light" | "dark" | "auto";
        "on:zitadel-signout"?: (event: CustomEvent<ZitadelSignoutDetail>) => void;
      };
      "zitadel-session": Omit<HTMLAttributes<HTMLElement>, "ref"> & {
        ref?: ZitadelSessionElement | ((el: ZitadelSessionElement) => void);
        "prop:project"?: ZitadelProject;
        "project-id"?: string;
        "proxy-path"?: string;
        "post-sign-out-url"?: string;
        heading?: string;
        "logout-label"?: string;
        variant?: "widget" | "page";
        theme?: "light" | "dark" | "auto";
        "prop:suppressHeader"?: boolean;
        "on:zitadel-signout"?: (event: CustomEvent<ZitadelSignoutDetail>) => void;
      };
    }
  }
}

export { configureZitadel, getApi, getZitadelConfig };
export type { ZitadelConfig, ZitadelProject };
export * from "./types";

// Re-exported so scaffolded apps can wire the business copy overlay without a
// direct @zitadel/components dependency (strict package managers reject those).
export { businessLocales } from "@zitadel/components";

const defaults = new WeakMap<object, Map<string, unknown>>();

/**
 * Assigns the given props to a widget element as properties, leaving unset
 * (`undefined`) ones to the element's own defaults. A `prop:` binding assigns
 * `undefined` once its value changes, which overwrites the element's default.
 *
 * The element's own value is remembered before a prop is first overridden and
 * restored when the prop becomes unset again, so a reactive prop going from a
 * value back to `undefined` does not leave the stale override in place.
 */
function assignGiven(element: object, props: Record<string, unknown>): void {
  const target = element as Record<string, unknown>;
  let saved = defaults.get(element);
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) {
      if (!saved) {
        saved = new Map();
        defaults.set(element, saved);
      }
      if (!saved.has(key)) {
        saved.set(key, target[key]);
      }
      target[key] = value;
    } else if (saved?.has(key)) {
      target[key] = saved.get(key);
      saved.delete(key);
    }
  }
}

/**
 * Solid component wrapping the `<zitadel-login>` web component. Binds the
 * {@link ZitadelProject} handle as a DOM property (or the discrete project id /
 * proxy path as attributes) and forwards the widget's `zitadel-*` events as
 * optional callbacks.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-login>` DOM element,
 * so consumers can imperatively access the upgraded web component.
 */
export function ZitadelLogin(
  props: ZitadelLoginProps & {
    ref?: ZitadelLoginElement | ((el: ZitadelLoginElement) => void);
  },
): JSX.Element {
  const element = (
    <zitadel-login
      ref={props.ref}
      prop:project={props.project}
      prop:locales={props.locales}
      project-id={props.projectId}
      proxy-path={props.proxyPath}
      purpose={props.purpose ?? "login"}
      flow-name={props.flowName}
      post-sign-in-url={props.postSignInUrl}
      on:zitadel-flow-step={(event) => props.onFlowStep?.(event.detail)}
      on:zitadel-flow-input={(event) => props.onFlowInput?.(event.detail)}
      on:zitadel-flow-complete={(event) => props.onFlowComplete?.(event.detail)}
      on:zitadel-flow-redirect={(event) => props.onFlowRedirect?.(event.detail)}
      on:zitadel-flow-error={(event) => props.onFlowError?.(event.detail)}
    />
  ) as ZitadelLoginElement;
  createRenderEffect(() =>
    assignGiven(element, {
      lang: props.lang,
      variant: props.variant,
      theme: props.theme,
      suppressHeader: props.suppressHeader,
      suppressPasswordToggle: props.suppressPasswordToggle,
    }),
  );
  return element;
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
export function ZitadelLogout(
  props: ZitadelLogoutProps & {
    ref?: ZitadelLogoutElement | ((el: ZitadelLogoutElement) => void);
  },
): JSX.Element {
  const element = (
    <zitadel-logout
      ref={props.ref}
      prop:project={props.project}
      project-id={props.projectId}
      proxy-path={props.proxyPath}
      post-sign-out-url={props.postSignOutUrl}
      on:zitadel-signout={(event) => props.onSignout?.(event.detail)}
    />
  ) as ZitadelLogoutElement;
  createRenderEffect(() => assignGiven(element, { theme: props.theme }));
  return element;
}

/**
 * Solid component wrapping the `<zitadel-session>` web component — the
 * post-sign-in "signed in as" card. Binds the {@link ZitadelProject} handle as
 * a DOM property (or the discrete project id / proxy path as attributes) and
 * forwards the widget's `zitadel-signout` event as an optional callback.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-session>` DOM element.
 */
export function ZitadelSession(
  props: ZitadelSessionProps & {
    ref?: ZitadelSessionElement | ((el: ZitadelSessionElement) => void);
  },
): JSX.Element {
  const element = (
    <zitadel-session
      ref={props.ref}
      prop:project={props.project}
      project-id={props.projectId}
      proxy-path={props.proxyPath}
      post-sign-out-url={props.postSignOutUrl}
      on:zitadel-signout={(event) => props.onSignout?.(event.detail)}
    />
  ) as ZitadelSessionElement;
  createRenderEffect(() =>
    assignGiven(element, {
      heading: props.heading,
      logoutLabel: props.logoutLabel,
      variant: props.variant,
      theme: props.theme,
      suppressHeader: props.suppressHeader,
    }),
  );
  return element;
}
