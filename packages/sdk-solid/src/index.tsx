import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

/*
 * Registers <zitadel-login>, <zitadel-logout> and <zitadel-session> in the browser.
 * The edge build of the components package has no elements, so this does nothing there.
 */
import "@zitadel/components";
import type { JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

import { standardAttributes, widgetTags } from "@zitadel/sdk-core/types";
import {
  configureZitadel,
  getApi,
  getZitadelConfig,
  type ZitadelConfig,
  type ZitadelProject,
} from "@zitadel/sdk-core/config";

import type {
  ZitadelFlowCompleteDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowStepDetail,
  ZitadelSignoutDetail,
  ZitadelWidgetAttributes,
} from "./types.js";
import type {
  ZitadelLoginProps as CoreLoginProps,
  ZitadelLogoutProps as CoreLogoutProps,
  ZitadelSessionProps as CoreSessionProps,
} from "@zitadel/sdk-core/types";

/**
 * Adds the three widget tags to Solid's JSX typing, so `<zitadel-login>`, `<zitadel-logout>` and
 * `<zitadel-session>` type-check as intrinsic elements.
 *
 * The components in this package render these tags through `Dynamic`, which does not need the
 * typing, but an app that writes a widget tag by hand in JSX does. Properties that carry objects
 * or booleans use Solid's `prop:` prefix so they are assigned as DOM properties, never as
 * attributes. Event listeners use the `on:` prefix so the custom event names are not lower-cased.
 */
declare module "solid-js" {
  namespace JSX {
    /**
     * The widget tags Solid accepts in JSX.
     */
    interface IntrinsicElements {
      /**
       * The sign-in flow widget. Its attributes and properties mirror the props of
       * {@link ZitadelLogin}.
       */
      [widgetTags.login]: Omit<HTMLAttributes<HTMLElement>, "ref"> & {
        /**
         * The element reference, as a variable or a callback.
         */
        ref?: ZitadelLoginElement | ((el: ZitadelLoginElement) => void);
        /**
         * The project handle, assigned as a DOM property because it carries the publishable key.
         */
        "prop:project"?: ZitadelProject;
        /**
         * The locale overlays, assigned as a DOM property.
         */
        "prop:locales"?: Record<string, Partial<Record<string, string>>>;
        /**
         * The language tag, assigned as a DOM property.
         */
        "prop:lang"?: string;
        /**
         * The project id attribute, present in server markup.
         */
        "project-id"?: string;
        /**
         * The same-origin proxy path attribute, present in server markup.
         */
        "proxy-path"?: string;
        /**
         * The base URL attribute of the Zitadel instance.
         */
        url?: string;
        /**
         * The flow purpose attribute.
         */
        purpose?: string;
        /**
         * The attribute that selects a flow definition by name.
         */
        "flow-name"?: string;
        /**
         * The attribute that names where to go after a successful sign-in.
         */
        "post-sign-in-url"?: string;
        /**
         * Whether the post sign-in URL wins over a return target, assigned as a DOM property.
         */
        "prop:forcePostSignInUrl"?: boolean;
        /**
         * The layout attribute: a framed widget or a full page.
         */
        variant?: "widget" | "page";
        /**
         * The color scheme attribute.
         */
        theme?: "light" | "dark" | "auto";
        /**
         * Whether to hide the widget header, assigned as a DOM property.
         */
        "prop:suppressHeader"?: boolean;
        /**
         * Whether to hide the password visibility toggle, assigned as a DOM property.
         */
        "prop:suppressPasswordToggle"?: boolean;
        /**
         * Called when the flow shows a new step.
         */
        "on:zitadel-flow-step"?: (event: CustomEvent<ZitadelFlowStepDetail>) => void;
        /**
         * Called when the visitor submits input in a step.
         */
        "on:zitadel-flow-input"?: (event: CustomEvent<ZitadelFlowInputDetail>) => void;
        /**
         * Called when the flow completes.
         */
        "on:zitadel-flow-complete"?: (event: CustomEvent<ZitadelFlowCompleteDetail>) => void;
        /**
         * Called when the flow is about to redirect, for example to an identity provider.
         */
        "on:zitadel-flow-redirect"?: (event: CustomEvent<ZitadelFlowRedirectDetail>) => void;
        /**
         * Called when the flow fails.
         */
        "on:zitadel-flow-error"?: (event: CustomEvent<ZitadelFlowErrorDetail>) => void;
      };
      /**
       * The sign-out widget. Its attributes and properties mirror the props of
       * {@link ZitadelLogout}.
       */
      [widgetTags.logout]: Omit<HTMLAttributes<HTMLElement>, "ref"> & {
        /**
         * The element reference, as a variable or a callback.
         */
        ref?: ZitadelLogoutElement | ((el: ZitadelLogoutElement) => void);
        /**
         * The project handle, assigned as a DOM property because it carries the publishable key.
         */
        "prop:project"?: ZitadelProject;
        /**
         * The project id attribute, present in server markup.
         */
        "project-id"?: string;
        /**
         * The same-origin proxy path attribute, present in server markup.
         */
        "proxy-path"?: string;
        /**
         * The base URL attribute of the Zitadel instance.
         */
        url?: string;
        /**
         * The attribute that names where to go after sign-out.
         */
        "post-sign-out-url"?: string;
        /**
         * The color scheme attribute.
         */
        theme?: "light" | "dark" | "auto";
        /**
         * Called when the session ends.
         */
        "on:zitadel-signout"?: (event: CustomEvent<ZitadelSignoutDetail>) => void;
      };
      /**
       * The signed-in session card. Its attributes and properties mirror the props of
       * {@link ZitadelSession}.
       */
      [widgetTags.session]: Omit<HTMLAttributes<HTMLElement>, "ref"> & {
        /**
         * The element reference, as a variable or a callback.
         */
        ref?: ZitadelSessionElement | ((el: ZitadelSessionElement) => void);
        /**
         * The project handle, assigned as a DOM property because it carries the publishable key.
         */
        "prop:project"?: ZitadelProject;
        /**
         * The project id attribute, present in server markup.
         */
        "project-id"?: string;
        /**
         * The same-origin proxy path attribute, present in server markup.
         */
        "proxy-path"?: string;
        /**
         * The base URL attribute of the Zitadel instance.
         */
        url?: string;
        /**
         * The attribute that names where to go after sign-out.
         */
        "post-sign-out-url"?: string;
        /**
         * The heading text attribute of the card.
         */
        heading?: string;
        /**
         * The label attribute of the sign-out action.
         */
        "logout-label"?: string;
        /**
         * The layout attribute: a framed widget or a full page.
         */
        variant?: "widget" | "page";
        /**
         * The color scheme attribute.
         */
        theme?: "light" | "dark" | "auto";
        /**
         * Whether to hide the card header, assigned as a DOM property.
         */
        "prop:suppressHeader"?: boolean;
        /**
         * Called when the session ends.
         */
        "on:zitadel-signout"?: (event: CustomEvent<ZitadelSignoutDetail>) => void;
      };
    }
  }
}

/**
 * Maps the project coordinates to the attributes the widget reads, so they are present in the
 * server markup.
 *
 * Solid assigns the {@link ZitadelProject} handle to the element as a DOM property, and a property
 * is never written into server HTML. Without these attributes a server-rendered page would carry
 * no project coordinates until hydration. The handle also stays a property, because it carries the
 * publishable key and is what the element prefers once Solid hydrates. The fields of the handle
 * win over the discrete props, as they do inside the widget. An empty proxy path is written as
 * `/`, because the widget treats an empty `proxy-path` attribute as unset and falls back to its
 * default, while `/` normalizes to the site root.
 *
 * @param props - The component props that carry the project coordinates.
 * @returns The `project-id`, `proxy-path` and `url` attributes. A value is `undefined`, and so
 * omitted from the markup, when neither the handle nor the discrete prop sets it.
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
 * Forwards a widget event's detail to the app callback and registers the promise the callback
 * returns on the detail's `waitUntil`.
 *
 * The widget navigates right after it dispatches `zitadel-flow-complete`, `zitadel-flow-redirect`
 * and `zitadel-signout`. A handler that is asynchronous, such as one that loads lazily, could be
 * cut off by that navigation, so the promise it returns is registered and the widget waits for it,
 * for at most two seconds, before it navigates. Other events carry no `waitUntil`, so for them
 * registration does nothing. A synchronous callback needs no care: its return value is registered
 * and settles at once.
 *
 * @typeParam Detail - The event detail type the callback receives.
 * @param event - The event the widget dispatched. A value that is not a `CustomEvent` is ignored.
 * @param handler - The app callback, or `undefined` when the app registered none.
 */
function withDetail<Detail>(
  event: Event,
  handler: ((detail: Detail) => unknown) | undefined,
): void {
  if (!(event instanceof CustomEvent) || !handler) {
    return;
  }
  const result = handler(event.detail);
  event.detail.waitUntil?.(result);
}

/**
 * The props of {@link ZitadelLogin}: the widget props from `@zitadel/sdk-core`, the standard HTML
 * attributes and a `ref`.
 *
 * The standard HTML attributes let an app style and label the
 * sign-in flow without a wrapper element. Nothing else reaches the element: a prop outside the widget
 * props and those attributes is a type error, so nothing the type accepts is dropped. The widget
 * props themselves are documented once, in `@zitadel/sdk-core`.
 *
 * @example
 * ```tsx
 * const props: ZitadelLoginProps = { project, class: "auth-card" };
 * ```
 */
export type ZitadelLoginProps = CoreLoginProps &
  ZitadelWidgetAttributes & {
    /**
     * Receives the underlying `<zitadel-login>` element, either as a variable or through a
     * callback.
     *
     * Use it to reach the upgraded web component imperatively, for example to call a method on it
     * or to read a property. Solid resolves the reference after it creates the element, which
     * happens in the browser only: it is never called while rendering on the server, and the
     * element is not upgraded yet at that moment if the components module has not registered it.
     *
     * @example
     * ```tsx
     * <ZitadelLogin project={project} ref={(el) => console.log(el.tagName)} />
     * ```
     */
    ref?: ZitadelLoginElement | ((el: ZitadelLoginElement) => void);
  };

/**
 * The props of {@link ZitadelLogout}: the widget props from `@zitadel/sdk-core`, the standard HTML
 * attributes and a `ref`.
 *
 * The standard HTML attributes let an app style and label the
 * sign-out button without a wrapper element. Nothing else reaches the element: a prop outside the widget
 * props and those attributes is a type error, so nothing the type accepts is dropped. The widget
 * props themselves are documented once, in `@zitadel/sdk-core`.
 *
 * @example
 * ```tsx
 * const props: ZitadelLogoutProps = { project, class: "auth-card" };
 * ```
 */
export type ZitadelLogoutProps = CoreLogoutProps &
  ZitadelWidgetAttributes & {
    /**
     * Receives the underlying `<zitadel-logout>` element, either as a variable or through a
     * callback.
     *
     * Use it to reach the upgraded web component imperatively, for example to call a method on it
     * or to read a property. Solid resolves the reference after it creates the element, which
     * happens in the browser only: it is never called while rendering on the server, and the
     * element is not upgraded yet at that moment if the components module has not registered it.
     *
     * @example
     * ```tsx
     * <ZitadelLogout project={project} ref={(el) => console.log(el.tagName)} />
     * ```
     */
    ref?: ZitadelLogoutElement | ((el: ZitadelLogoutElement) => void);
  };

/**
 * The props of {@link ZitadelSession}: the widget props from `@zitadel/sdk-core`, the standard HTML
 * attributes and a `ref`.
 *
 * The standard HTML attributes let an app style and label the
 * signed-in session card without a wrapper element. Nothing else reaches the element: a prop outside the widget
 * props and those attributes is a type error, so nothing the type accepts is dropped. The widget
 * props themselves are documented once, in `@zitadel/sdk-core`.
 *
 * @example
 * ```tsx
 * const props: ZitadelSessionProps = { project, class: "auth-card" };
 * ```
 */
export type ZitadelSessionProps = CoreSessionProps &
  ZitadelWidgetAttributes & {
    /**
     * Receives the underlying `<zitadel-session>` element, either as a variable or through a
     * callback.
     *
     * Use it to reach the upgraded web component imperatively, for example to call a method on it
     * or to read a property. Solid resolves the reference after it creates the element, which
     * happens in the browser only: it is never called while rendering on the server, and the
     * element is not upgraded yet at that moment if the components module has not registered it.
     *
     * @example
     * ```tsx
     * <ZitadelSession project={project} ref={(el) => console.log(el.tagName)} />
     * ```
     */
    ref?: ZitadelSessionElement | ((el: ZitadelSessionElement) => void);
  };

/**
 * Re-exports the configuration helpers of `@zitadel/sdk-core`, so an app needs no direct dependency on
 * it.
 *
 * {@link configureZitadel} creates the project handle that the components take as `project`,
 * {@link getZitadelConfig} reads the configuration back and {@link getApi} returns the API client
 * for the configured project.
 */
export { configureZitadel, getApi, getZitadelConfig };
export type { ZitadelConfig, ZitadelProject };
export type {
  ZitadelFlowPurpose,
  ZitadelFlowStep,
  ZitadelFlowBehavior,
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowStepDetail,
  ZitadelSignoutDetail,
} from "./types.js";

/*
 * Re-exported so scaffolded apps can wire the business copy overlay without a
 * direct @zitadel/components dependency (strict package managers reject those).
 */
export { businessLocales } from "@zitadel/components";

/**
 * Renders the `<zitadel-login>` sign-in flow widget.
 *
 * Use it on the page that signs visitors in. It starts a flow for the given purpose, or resumes
 * one, and renders every screen of it, so the app builds none of them. The component binds the
 * {@link ZitadelProject} handle as a DOM property, writes the project coordinates as attributes
 * (so they are in server markup), and forwards the `zitadel-*` events of the widget to the
 * optional callbacks.
 *
 * The component builds its element with Solid's `Dynamic` and the tag name, on purpose. A DOM
 * template that Solid's compiler creates at import time needs a DOM, so the published dist could
 * not load or server-render on edge runtimes such as Cloudflare Workers and Vercel Edge. With
 * `Dynamic` the dist loads anywhere and server rendering writes a plain custom element tag with
 * its attributes. Do not replace `Dynamic` with a literal `<zitadel-login>` tag in this package.
 *
 * On the server only the tag and its attributes are written; the widget upgrades and starts its
 * flow in the browser after hydration. When a callback for `zitadel-flow-complete` or
 * `zitadel-flow-redirect` returns a promise, the widget waits for it, for at most two seconds,
 * before it navigates. The standard HTML attributes are passed to the element with Solid's
 * `attr:` prefix, because Solid would otherwise assign them to a custom element as properties.
 * The `purpose` defaults to `login`.
 *
 * @param props - The widget props, the standard HTML attributes and an optional `ref`.
 * @returns The JSX element of the widget.
 *
 * @example
 * ```tsx
 * import { configureZitadel, ZitadelLogin } from "@zitadel/sdk-solid";
 *
 * const project = configureZitadel({ projectId: "my-project" });
 *
 * export function LoginPage() {
 *   return <ZitadelLogin project={project} onFlowComplete={() => console.log("signed in")} />;
 * }
 * ```
 */
export function ZitadelLogin(props: ZitadelLoginProps): JSX.Element {
  // The standard HTML attributes are the only extra props the element takes. Solid would assign
  // them to a custom element as properties, so they take its `attr:` prefix.
  const attributes = () => standardAttributes(props, "attr:");
  return (
    <Dynamic
      component={widgetTags.login}
      {...attributes()}
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
      on:zitadel-flow-step={(event) => withDetail(event, props.onFlowStep)}
      on:zitadel-flow-input={(event) => withDetail(event, props.onFlowInput)}
      on:zitadel-flow-complete={(event) => withDetail(event, props.onFlowComplete)}
      on:zitadel-flow-redirect={(event) => withDetail(event, props.onFlowRedirect)}
      on:zitadel-flow-error={(event) => withDetail(event, props.onFlowError)}
    />
  );
}

/**
 * Renders the `<zitadel-logout>` sign-out widget.
 *
 * Use it where a visitor ends their session. The component binds the {@link ZitadelProject}
 * handle as a DOM property, writes the project coordinates as attributes (so they are in server
 * markup), and forwards the `zitadel-signout` event of the widget to the optional callback.
 *
 * The component builds its element with Solid's `Dynamic` and the tag name, on purpose. A DOM
 * template that Solid's compiler creates at import time needs a DOM, so the published dist could
 * not load or server-render on edge runtimes. With `Dynamic` the dist loads anywhere. Do not
 * replace it with a literal `<zitadel-logout>` tag.
 *
 * When the callback returns a promise, the widget waits for it, for at most two seconds, before
 * it navigates. The standard HTML attributes are passed with Solid's `attr:` prefix.
 *
 * @param props - The widget props, the standard HTML attributes and an optional `ref`.
 * @returns The JSX element of the widget.
 *
 * @example
 * ```tsx
 * import { ZitadelLogout } from "@zitadel/sdk-solid";
 *
 * <ZitadelLogout project={project} postSignOutUrl="/" />;
 * ```
 */
export function ZitadelLogout(props: ZitadelLogoutProps): JSX.Element {
  // The standard HTML attributes are the only extra props the element takes. Solid would assign
  // them to a custom element as properties, so they take its `attr:` prefix.
  const attributes = () => standardAttributes(props, "attr:");
  return (
    <Dynamic
      component={widgetTags.logout}
      {...attributes()}
      ref={props.ref}
      prop:project={props.project}
      {...projectAttributes(props)}
      post-sign-out-url={props.postSignOutUrl}
      theme={props.theme}
      on:zitadel-signout={(event) => withDetail(event, props.onSignout)}
    />
  );
}

/**
 * Renders the `<zitadel-session>` card that shows who is signed in, with a sign-out action.
 *
 * Use it after sign-in, for example in a header or on a dashboard. The component binds the
 * {@link ZitadelProject} handle as a DOM property, writes the project coordinates as attributes
 * (so they are in server markup), and forwards the `zitadel-signout` event of the widget to the
 * optional callback.
 *
 * The component builds its element with Solid's `Dynamic` and the tag name, on purpose. A DOM
 * template that Solid's compiler creates at import time needs a DOM, so the published dist could
 * not load or server-render on edge runtimes. With `Dynamic` the dist loads anywhere. Do not
 * replace it with a literal `<zitadel-session>` tag.
 *
 * When the callback returns a promise, the widget waits for it, for at most two seconds, before
 * it navigates. The standard HTML attributes are passed with Solid's `attr:` prefix.
 *
 * @param props - The widget props, the standard HTML attributes and an optional `ref`.
 * @returns The JSX element of the widget.
 *
 * @example
 * ```tsx
 * import { ZitadelSession } from "@zitadel/sdk-solid";
 *
 * <ZitadelSession project={project} heading="Signed in" />;
 * ```
 */
export function ZitadelSession(props: ZitadelSessionProps): JSX.Element {
  // The standard HTML attributes are the only extra props the element takes. Solid would assign
  // them to a custom element as properties, so they take its `attr:` prefix.
  const attributes = () => standardAttributes(props, "attr:");
  return (
    <Dynamic
      component={widgetTags.session}
      {...attributes()}
      ref={props.ref}
      prop:project={props.project}
      {...projectAttributes(props)}
      post-sign-out-url={props.postSignOutUrl}
      heading={props.heading}
      logout-label={props.logoutLabel}
      variant={props.variant}
      theme={props.theme}
      prop:suppressHeader={props.suppressHeader}
      on:zitadel-signout={(event) => withDetail(event, props.onSignout)}
    />
  );
}
