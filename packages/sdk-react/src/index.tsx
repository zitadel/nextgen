import { createComponent, type EventName } from "@lit/react";
import {
  configureZitadel,
  getApi,
  getZitadelConfig,
  type ZitadelConfig,
  type ZitadelProject,
} from "@zitadel/api/config";
import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";
import {
  isStandardAttributeName,
  standardAttributes,
  widgetTags,
  ZITADEL_LOGIN_EVENTS,
  ZITADEL_LOGOUT_EVENTS,
  ZITADEL_SESSION_EVENTS,
  type WidgetTag,
  type ZitadelLoginEventMap,
  type ZitadelLogoutEventMap,
  type ZitadelSessionEventMap,
} from "@zitadel/sdk-core/types";
import * as React from "react";
// Registers <zitadel-login>, <zitadel-logout> and <zitadel-session> in the browser.
// The edge build of the components package has no elements, so this does nothing there.
import "@zitadel/components";

import type {
  ZitadelLoginProps,
  ZitadelLogoutProps,
  ZitadelSessionProps,
  ZitadelWidgetAttributes,
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
/** What `createComponent` takes as the element class: a constructor and its prototype. */
type ElementClass<Tag extends WidgetTag> = {
  new (): HTMLElementTagNameMap[Tag];
  prototype: HTMLElementTagNameMap[Tag];
};

/**
 * The one boundary: `createComponent` types its class as a constructor but only
 * reads `name` and `prototype`; a predicate narrows the stand-in without a cast.
 */
function isElementClass<Tag extends WidgetTag>(value: object): value is ElementClass<Tag> {
  return "name" in value && "prototype" in value;
}

/** The detail each widget event carries, by event name. */
type EventDetails = ZitadelLoginEventMap & ZitadelLogoutEventMap & ZitadelSessionEventMap;

/**
 * The second boundary: `createComponent` reads the event a handler receives from
 * the brand on its event name, which exists only in the type; a predicate
 * narrows the name to it after checking the name is a widget event.
 */
function isEventName<Name extends keyof EventDetails>(
  name: Name,
): name is Name & EventName<CustomEvent<EventDetails[Name]>> {
  return [...ZITADEL_LOGIN_EVENTS, ...ZITADEL_LOGOUT_EVENTS, ...ZITADEL_SESSION_EVENTS].some(
    (event) => event === name,
  );
}

/** A widget event's name, typed with the event it dispatches. */
function eventName<Name extends keyof EventDetails>(
  name: Name,
): EventName<CustomEvent<EventDetails[Name]>> {
  if (!isEventName(name)) throw new Error(`${name} is not a widget event`);
  return name;
}

/**
 * `createComponent` binds every key found on the element's prototype as a DOM
 * property, and a property is never written into server markup. The widget
 * starts its first flow when it upgrades, before React hydrates, so the keys
 * that define that flow must reach the browser as attributes. This hides the
 * given keys from that lookup: they are passed through as plain attributes
 * (server markup included) and the element still reads them as properties.
 * On the server the standard HTML attributes (`id`, `title`, `slot`, `role`, …)
 * are hidden too, so they are in the server markup; in the browser `createComponent`
 * keeps them, since it removes such an attribute when its prop goes, which React 19
 * does not do for a custom element.
 *
 * No element class is imported, because loading one needs a DOM and an edge
 * runtime has none. In the browser the prototype is the one of the class
 * registered under `tag`, looked up whenever a prop is classified. On the
 * server there is no class to ask: a prop this wrapper passes is a property
 * unless it is hidden, a standard attribute or a kebab-case attribute name.
 */
function asAttributes<Tag extends WidgetTag>(
  tag: Tag,
  ...keys: readonly string[]
): ElementClass<Tag> {
  const hidden = new Set<PropertyKey>(keys);
  const prototype = new Proxy(
    {},
    {
      has: (_target, key) => {
        if (hidden.has(key)) return false;
        if (typeof document !== "undefined")
          return key in (customElements.get(tag)?.prototype ?? {});
        return (
          typeof key === "string" &&
          !["children", "localName", "ref"].includes(key) &&
          !isStandardAttributeName(key) &&
          !key.includes("-")
        );
      },
    },
  );
  const elementClass = { name: tag, prototype };
  if (!isElementClass<Tag>(elementClass)) throw new Error(`${tag} has no element class`);
  return elementClass;
}

/**
 * The project coordinates as attributes, so they are in the server markup. The
 * `project` handle stays a property too: it carries the publishable key and is
 * what the element prefers once React hands it over.
 *
 * A handle with a publishable key writes none: attributes cannot carry the key,
 * so a widget that started from them would send its first request without the
 * bearer the project needs, and never retry. `ZitadelLogin` renders nothing for
 * such a handle until it has mounted, so its element is created with the
 * handle already bound.
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
  tagName: widgetTags.login,
  elementClass: asAttributes(widgetTags.login, "purpose", "resumeFlowId", "postSignInUrl", "url"),
  events: {
    onZitadelFlowStep: eventName("zitadel-flow-step"),
    onZitadelFlowInput: eventName("zitadel-flow-input"),
    onZitadelFlowComplete: eventName("zitadel-flow-complete"),
    onZitadelFlowRedirect: eventName("zitadel-flow-redirect"),
    onZitadelFlowError: eventName("zitadel-flow-error"),
  },
});

const ZitadelLogoutElementReact = createComponent({
  react: React,
  tagName: widgetTags.logout,
  elementClass: asAttributes(widgetTags.logout, "url"),
  events: {
    onZitadelSignout: eventName("zitadel-signout"),
    onZitadelSessionError: eventName("zitadel-session-error"),
  },
});

const ZitadelSessionElementReact = createComponent({
  react: React,
  tagName: widgetTags.session,
  elementClass: asAttributes(widgetTags.session, "url"),
  events: {
    onZitadelSignout: eventName("zitadel-signout"),
    onZitadelSessionError: eventName("zitadel-session-error"),
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
export type ZitadelLoginReactProps = ZitadelLoginProps &
  ZitadelWidgetAttributes & {
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
    {
      purpose,
      resumeFlowId,
      postSignInUrl,
      onFlowStep,
      onFlowInput,
      onFlowComplete,
      onFlowRedirect,
      onFlowError,
      ...props
    },
    ref,
  ) {
    // The standard HTML attributes are the only extra props the element takes.
    const attributes = standardAttributes(props);
    const keyed = Boolean(props.project?.publishableKey);
    const [mounted, setMounted] = React.useState(false);
    React.useEffect(() => setMounted(true), []);
    // A keyed handle cannot reach the element as attributes, and the element
    // starts its first flow when it first updates. Create it only once the
    // handle can be bound at the same time, never during server rendering.
    if (keyed && !mounted) return null;
    return (
      <ZitadelLoginElementReact
        {...attributes}
        ref={ref}
        project={props.project}
        projectId={props.projectId}
        proxyPath={props.proxyPath}
        variant={props.variant}
        theme={props.theme}
        suppressHeader={props.suppressHeader}
        suppressPasswordToggle={props.suppressPasswordToggle}
        forcePostSignInUrl={props.forcePostSignInUrl}
        locales={props.locales}
        lang={props.lang}
        previewState={props.previewState}
        previewSuccessStep={props.previewSuccessStep}
        purpose={purpose ?? "login"}
        flow-name={props.flowName}
        {...projectAttributes(props)}
        resume-flow-id={resumeFlowId || undefined}
        post-sign-in-url={postSignInUrl || undefined}
        onZitadelFlowStep={onFlowStep && ((event) => onFlowStep(event.detail))}
        onZitadelFlowInput={onFlowInput && ((event) => onFlowInput(event.detail))}
        onZitadelFlowComplete={onFlowComplete && ((event) => onFlowComplete(event.detail))}
        onZitadelFlowRedirect={onFlowRedirect && ((event) => onFlowRedirect(event.detail))}
        onZitadelFlowError={onFlowError && ((event) => onFlowError(event.detail))}
      >
        {props.children}
      </ZitadelLoginElementReact>
    );
  },
);

ZitadelLogin.displayName = "ZitadelLogin";

/** Props of `ZitadelLogout`: the widget's own plus the standard HTML attributes. */
export type ZitadelLogoutReactProps = ZitadelLogoutProps & ZitadelWidgetAttributes;

/**
 * React component wrapping the `<zitadel-logout>` web component. Binds the
 * `ZitadelProject` handle as a DOM property (or the discrete project id /
 * proxy path as attributes) and forwards the widget's `zitadel-signout` and
 * `zitadel-session-error` events as optional callbacks.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-logout>` DOM element,
 * so consumers can imperatively access the upgraded web component.
 */
export const ZitadelLogout = React.forwardRef<ZitadelLogoutElement, ZitadelLogoutReactProps>(
  function ZitadelLogout({ onSignout, onSessionError, ...props }, ref) {
    // The standard HTML attributes are the only extra props the element takes.
    const attributes = standardAttributes(props);
    return (
      <ZitadelLogoutElementReact
        {...attributes}
        project={props.project}
        projectId={props.projectId}
        proxyPath={props.proxyPath}
        theme={props.theme}
        {...projectAttributes(props)}
        post-sign-out-url={props.postSignOutUrl}
        ref={ref}
        onZitadelSignout={onSignout && ((event) => onSignout(event.detail))}
        onZitadelSessionError={onSessionError && ((event) => onSessionError(event.detail))}
      />
    );
  },
);

ZitadelLogout.displayName = "ZitadelLogout";

/** Props of `ZitadelSession`: the widget's own plus the standard HTML attributes. */
export type ZitadelSessionReactProps = ZitadelSessionProps & ZitadelWidgetAttributes;

/**
 * React component wrapping the `<zitadel-session>` web component — the
 * post-sign-in "signed in as" card. Binds the `ZitadelProject` handle as a DOM
 * property (or the discrete project id / proxy path as attributes) and forwards
 * the widget's `zitadel-signout` and `zitadel-session-error` events as optional
 * callbacks.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-session>` DOM element.
 */
export const ZitadelSession = React.forwardRef<ZitadelSessionElement, ZitadelSessionReactProps>(
  function ZitadelSession({ onSignout, onSessionError, ...props }, ref) {
    // The standard HTML attributes are the only extra props the element takes.
    const attributes = standardAttributes(props);
    return (
      <ZitadelSessionElementReact
        {...attributes}
        project={props.project}
        projectId={props.projectId}
        proxyPath={props.proxyPath}
        heading={props.heading}
        logoutLabel={props.logoutLabel}
        variant={props.variant}
        theme={props.theme}
        suppressHeader={props.suppressHeader}
        {...projectAttributes(props)}
        post-sign-out-url={props.postSignOutUrl}
        ref={ref}
        onZitadelSignout={onSignout && ((event) => onSignout(event.detail))}
        onZitadelSessionError={onSessionError && ((event) => onSessionError(event.detail))}
      />
    );
  },
);

ZitadelSession.displayName = "ZitadelSession";
