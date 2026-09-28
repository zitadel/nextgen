import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import "@zitadel/components";
import type { JSX } from "solid-js";

import {
  configureZitadel,
  getApi,
  getZitadelConfig,
  type ZitadelConfig,
  type ZitadelProject,
} from "@zitadel/api/config";

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

declare module "solid-js" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
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
        "on:zitadel-flow-step"?: (event: CustomEvent<ZitadelFlowStepDetail>) => void;
        "on:zitadel-flow-input"?: (event: CustomEvent<ZitadelFlowInputDetail>) => void;
        "on:zitadel-flow-complete"?: (event: CustomEvent<ZitadelFlowCompleteDetail>) => void;
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
  return (
    <zitadel-login
      ref={props.ref}
      prop:project={props.project}
      prop:locales={props.locales}
      prop:lang={props.lang}
      project-id={props.projectId}
      proxy-path={props.proxyPath}
      purpose={props.purpose ?? "login"}
      flow-name={props.flowName}
      post-sign-in-url={props.postSignInUrl}
      variant={props.variant}
      theme={props.theme}
      prop:suppressHeader={props.suppressHeader}
      on:zitadel-flow-step={(event) => props.onFlowStep?.(event.detail)}
      on:zitadel-flow-input={(event) => props.onFlowInput?.(event.detail)}
      on:zitadel-flow-complete={(event) => props.onFlowComplete?.(event.detail)}
      on:zitadel-flow-error={(event) => props.onFlowError?.(event.detail)}
    />
  );
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
  return (
    <zitadel-logout
      ref={props.ref}
      prop:project={props.project}
      project-id={props.projectId}
      proxy-path={props.proxyPath}
      post-sign-out-url={props.postSignOutUrl}
      theme={props.theme}
      on:zitadel-signout={(event) => props.onSignout?.(event.detail)}
    />
  );
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
  return (
    <zitadel-session
      ref={props.ref}
      prop:project={props.project}
      project-id={props.projectId}
      proxy-path={props.proxyPath}
      post-sign-out-url={props.postSignOutUrl}
      heading={props.heading}
      logout-label={props.logoutLabel}
      variant={props.variant}
      theme={props.theme}
      prop:suppressHeader={props.suppressHeader}
      on:zitadel-signout={(event) => props.onSignout?.(event.detail)}
    />
  );
}
