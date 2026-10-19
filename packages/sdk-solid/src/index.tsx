import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import "@zitadel/components";
import { splitProps, type JSX } from "solid-js";

import {
  configureZitadel,
  getApi,
  getZitadelConfig,
  type ZitadelConfig,
  type ZitadelProject,
} from "@zitadel/api/config";

import { asElementAttributes } from "./attributes";
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
  ZitadelWidgetAttributes,
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
        url?: string;
        purpose?: string;
        "flow-name"?: string;
        "post-sign-in-url"?: string;
        "prop:forcePostSignInUrl"?: boolean;
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
        url?: string;
        "post-sign-out-url"?: string;
        theme?: "light" | "dark" | "auto";
        "on:zitadel-signout"?: (event: CustomEvent<ZitadelSignoutDetail>) => void;
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
        "on:zitadel-signout"?: (event: CustomEvent<ZitadelSignoutDetail>) => void;
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

/** Props of {@link ZitadelLogin}: the widget's own plus the element's HTML attributes. */
export type ZitadelLoginSolidProps = ZitadelLoginProps &
  ZitadelWidgetAttributes<ZitadelLoginProps> & {
    ref?: ZitadelLoginElement | ((el: ZitadelLoginElement) => void);
  };

/** Props of {@link ZitadelLogout}: the widget's own plus the element's HTML attributes. */
export type ZitadelLogoutSolidProps = ZitadelLogoutProps &
  ZitadelWidgetAttributes<ZitadelLogoutProps> & {
    ref?: ZitadelLogoutElement | ((el: ZitadelLogoutElement) => void);
  };

/** Props of {@link ZitadelSession}: the widget's own plus the element's HTML attributes. */
export type ZitadelSessionSolidProps = ZitadelSessionProps &
  ZitadelWidgetAttributes<ZitadelSessionProps> & {
    ref?: ZitadelSessionElement | ((el: ZitadelSessionElement) => void);
  };

/**
 * The props each wrapper owns. Everything else a consumer passes (`class`,
 * `style`, `id`, `title`, `slot`, `hidden`, `data-*`, `aria-*`, `role`,
 * `tabindex`, …) is forwarded to the widget element, under the wrapper's own
 * bindings, so a widget prop always wins over a standard attribute of the same
 * name. Each list is checked against its props type, so a prop added there
 * without being listed here fails `tsc` instead of leaking onto the element.
 */
const LOGIN_PROPS = [
  "ref",
  "project",
  "projectId",
  "proxyPath",
  "variant",
  "theme",
  "suppressHeader",
  "suppressPasswordToggle",
  "purpose",
  "flowName",
  "postSignInUrl",
  "forcePostSignInUrl",
  "resumeFlowId",
  "locales",
  "lang",
  "onFlowStep",
  "onFlowInput",
  "onFlowComplete",
  "onFlowRedirect",
  "onFlowError",
] as const satisfies readonly (keyof ZitadelLoginSolidProps)[];

const LOGOUT_PROPS = [
  "ref",
  "project",
  "projectId",
  "proxyPath",
  "postSignOutUrl",
  "theme",
  "onSignout",
] as const satisfies readonly (keyof ZitadelLogoutSolidProps)[];

const SESSION_PROPS = [
  "ref",
  "project",
  "projectId",
  "proxyPath",
  "postSignOutUrl",
  "heading",
  "logoutLabel",
  "variant",
  "theme",
  "suppressHeader",
  "onSignout",
] as const satisfies readonly (keyof ZitadelSessionSolidProps)[];

type Unlisted<Props, Listed> = Exclude<keyof Props, Listed>;
const everyPropListed: [
  Unlisted<ZitadelLoginProps, (typeof LOGIN_PROPS)[number]>,
  Unlisted<ZitadelLogoutProps, (typeof LOGOUT_PROPS)[number]>,
  Unlisted<ZitadelSessionProps, (typeof SESSION_PROPS)[number]>,
] extends [never, never, never]
  ? true
  : never = true;
void everyPropListed;

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
export function ZitadelLogin(props: ZitadelLoginSolidProps): JSX.Element {
  const [, attributes] = splitProps(props, LOGIN_PROPS);
  return (
    <zitadel-login
      {...asElementAttributes(attributes)}
      ref={props.ref}
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
      on:zitadel-flow-step={(event) => props.onFlowStep?.(event.detail)}
      on:zitadel-flow-input={(event) => props.onFlowInput?.(event.detail)}
      on:zitadel-flow-complete={(event) => props.onFlowComplete?.(event.detail)}
      on:zitadel-flow-redirect={(event) => props.onFlowRedirect?.(event.detail)}
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
export function ZitadelLogout(props: ZitadelLogoutSolidProps): JSX.Element {
  const [, attributes] = splitProps(props, LOGOUT_PROPS);
  return (
    <zitadel-logout
      {...asElementAttributes(attributes)}
      ref={props.ref}
      prop:project={props.project}
      {...projectAttributes(props)}
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
export function ZitadelSession(props: ZitadelSessionSolidProps): JSX.Element {
  const [, attributes] = splitProps(props, SESSION_PROPS);
  return (
    <zitadel-session
      {...asElementAttributes(attributes)}
      ref={props.ref}
      prop:project={props.project}
      {...projectAttributes(props)}
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
