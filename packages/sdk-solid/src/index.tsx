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
  CreateFlowBodyPurpose,
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

// dom-expressions compiles every non-`attr:` binding on a custom element
// (dashed names included) to a DOM property assignment on the client:
// `project-id` sets `el.projectId`. Server rendering writes the plain
// bindings as attributes, which the element reads on upgrade; `prop:`
// bindings are assigned on the client only.
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
        url?: string;
        purpose?: CreateFlowBodyPurpose;
        "flow-name"?: string;
        "post-sign-in-url"?: string;
        "resume-flow-id"?: string;
        "preview-state"?: ZitadelLoginElement["previewState"];
        "preview-success-step"?: string;
        variant?: "widget" | "page";
        theme?: "light" | "dark" | "auto";
        "prop:suppressHeader"?: boolean;
        "suppress-header"?: boolean;
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
        url?: string;
        "post-sign-out-url"?: string;
        theme?: "light" | "dark" | "auto";
        "on:zitadel-signout"?: (event: CustomEvent<ZitadelSignoutDetail>) => void;
        "on:zitadel-session-missing"?: (event: CustomEvent<ZitadelSessionMissingDetail>) => void;
        "on:zitadel-session-error"?: (event: CustomEvent<ZitadelSessionErrorDetail>) => void;
      };
      "zitadel-session": Omit<HTMLAttributes<HTMLElement>, "ref"> & {
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
        "suppress-header"?: boolean;
        "on:zitadel-signout"?: (event: CustomEvent<ZitadelSignoutDetail>) => void;
        "on:zitadel-session-missing"?: (event: CustomEvent<ZitadelSessionMissingDetail>) => void;
        "on:zitadel-session-error"?: (event: CustomEvent<ZitadelSessionErrorDetail>) => void;
      };
    }
  }
}

export { configureZitadel, getApi, getZitadelConfig };
export type { ZitadelConfig, ZitadelProject };
// Type-only, so the preserved-JSX build (`dist/index.jsx`, the `solid`
// export condition) carries no extensionless runtime import of `./types`.
export type * from "./types";

// Re-exported so scaffolded apps can wire the business copy overlay without a
// direct @zitadel/components dependency (strict package managers reject those).
export { businessLocales } from "@zitadel/components";

/**
 * Solid component wrapping the `<zitadel-login>` web component. Binds every prop
 * (the {@link ZitadelProject} handle, or the discrete project id / proxy path,
 * and the rest) as a DOM property, forwards the widget's `zitadel-*` events as
 * optional callbacks, and renders `children` into the element (e.g. content
 * for its `attribution-trailing` slot). An unset or `undefined` prop leaves
 * the element's own default in place.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-login>` DOM element,
 * so consumers can imperatively access the upgraded web component.
 */
export function ZitadelLogin(
  props: ZitadelLoginProps & {
    ref?: ZitadelLoginElement | ((el: ZitadelLoginElement) => void);
    children?: JSX.Element;
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
      purpose={props.purpose}
      flow-name={props.flowName}
      post-sign-in-url={props.postSignInUrl}
      variant={props.variant}
      theme={props.theme}
      prop:suppressHeader={props.suppressHeader}
      on:zitadel-flow-step={(event) => props.onFlowStep?.(event.detail)}
      on:zitadel-flow-input={(event) => props.onFlowInput?.(event.detail)}
      on:zitadel-flow-complete={(event) => props.onFlowComplete?.(event.detail)}
      on:zitadel-flow-redirect={(event) => props.onFlowRedirect?.(event.detail)}
      on:zitadel-flow-error={(event) => props.onFlowError?.(event.detail)}
    >
      {props.children}
    </zitadel-login>
  );
}

/**
 * Solid component wrapping the `<zitadel-logout>` web component. Binds every prop
 * (the {@link ZitadelProject} handle, or the discrete project id / proxy path,
 * and the rest) as a DOM property, forwards the widget's `zitadel-signout`,
 * `zitadel-session-missing` and `zitadel-session-error` events as optional callbacks, and renders `children` into the element, so
 * a `<template>` child switches it to template mode.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-logout>` DOM element,
 * so consumers can imperatively access the upgraded web component.
 */
export function ZitadelLogout(
  props: ZitadelLogoutProps & {
    ref?: ZitadelLogoutElement | ((el: ZitadelLogoutElement) => void);
    children?: JSX.Element;
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
      on:zitadel-session-missing={(event) => props.onSessionMissing?.(event.detail)}
      on:zitadel-session-error={(event) => props.onSessionError?.(event.detail)}
    >
      {props.children}
    </zitadel-logout>
  );
}

/**
 * Solid component wrapping the `<zitadel-session>` web component — the
 * post-sign-in "signed in as" card. Binds every prop (the {@link ZitadelProject}
 * handle, or the discrete project id / proxy path, and the rest) as a DOM
 * property, forwards the widget's `zitadel-signout`, `zitadel-session-missing`
 * and `zitadel-session-error` events as optional callbacks, and renders `children` into the element. An unset or `undefined`
 * prop leaves the element's own default in place.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-session>` DOM element.
 */
export function ZitadelSession(
  props: ZitadelSessionProps & {
    ref?: ZitadelSessionElement | ((el: ZitadelSessionElement) => void);
    children?: JSX.Element;
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
      on:zitadel-session-missing={(event) => props.onSessionMissing?.(event.detail)}
      on:zitadel-session-error={(event) => props.onSessionError?.(event.detail)}
    >
      {props.children}
    </zitadel-session>
  );
}
