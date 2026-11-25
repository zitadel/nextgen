import { createComponent, type EventName } from "@lit/react";
import {
  configureZitadel,
  getApi,
  getZitadelConfig,
  type ZitadelConfig,
  type ZitadelProject,
} from "@zitadel/sdk-core/config";
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
  type ZitadelLoginProps as ZitadelLoginWidgetProps,
  type ZitadelLogoutProps as ZitadelLogoutWidgetProps,
  type ZitadelSessionProps as ZitadelSessionWidgetProps,
  type ZitadelLoginEventMap,
  type ZitadelLogoutEventMap,
  type ZitadelSessionEventMap,
} from "@zitadel/sdk-core/types";
import * as React from "react";
/*
 * Registers <zitadel-login>, <zitadel-logout> and <zitadel-session> in the browser.
 * The edge build of the components package has no elements, so this does nothing there.
 */
import "@zitadel/components";

import type { ZitadelWidgetAttributes } from "./types.js";

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
} from "@zitadel/sdk-core/types";

export { getSession, sessionStore } from "@zitadel/sdk-core/session";
export type {
  ClientAuthResult,
  ClientAuthState,
  ClientSession,
  GetSessionOptions,
  SessionError,
  SessionErrorCode,
  SessionSnapshot,
  SessionStatus,
  SessionStore,
  SessionStoreOptions,
} from "@zitadel/sdk-core/session";
export { useSession } from "./session.js";
export type { UseSessionResult } from "./session.js";

/*
 * Re-exported so scaffolded apps can wire the business copy overlay without a
 * direct @zitadel/components dependency (strict package managers reject those).
 */
export { businessLocales } from "@zitadel/components";

/**
 * The shape `createComponent` takes as the element class: a constructor and its prototype.
 *
 * @typeParam Tag - The widget tag the class stands in for.
 */
type ElementClass<Tag extends WidgetTag> = {
  new (): HTMLElementTagNameMap[Tag];
  prototype: HTMLElementTagNameMap[Tag];
};

/**
 * Checks that a value can stand in for an element class.
 *
 * `createComponent` types its class as a constructor but only reads `name` and `prototype`, so
 * this predicate narrows the stand-in that `asAttributes` builds without a type cast.
 *
 * @typeParam Tag - The widget tag the class stands in for.
 * @param value - The object to check.
 * @returns Whether the object has a `name` and a `prototype`.
 */
function isElementClass<Tag extends WidgetTag>(value: object): value is ElementClass<Tag> {
  return "name" in value && "prototype" in value;
}

/**
 * The detail each widget event carries, keyed by the event name.
 */
type EventDetails = ZitadelLoginEventMap & ZitadelLogoutEventMap & ZitadelSessionEventMap;

/**
 * Checks that a name is one of the widget events and narrows it to the branded event name.
 *
 * `createComponent` reads the event a handler receives from a brand on the event name, and that
 * brand exists only in the type. This predicate narrows the name to it after it confirms the name
 * is a widget event, so no type cast is needed.
 *
 * @typeParam Name - The widget event name.
 * @param name - The event name to check.
 * @returns Whether the name is one of the login, logout or session widget events.
 */
function isEventName<Name extends keyof EventDetails>(
  name: Name,
): name is Name & EventName<CustomEvent<EventDetails[Name]>> {
  return [...ZITADEL_LOGIN_EVENTS, ...ZITADEL_LOGOUT_EVENTS, ...ZITADEL_SESSION_EVENTS].some(
    (event) => event === name,
  );
}

/**
 * Returns a widget event name typed with the event it dispatches.
 *
 * @typeParam Name - The widget event name.
 * @param name - The event name, such as `zitadel-flow-complete`.
 * @returns The same name, branded with the event type its handler receives.
 * @throws Error when the name is not a widget event.
 */
function eventName<Name extends keyof EventDetails>(
  name: Name,
): EventName<CustomEvent<EventDetails[Name]>> {
  if (!isEventName(name)) throw new Error(`${name} is not a widget event`);
  return name;
}

/**
 * Builds the stand-in element class that makes `createComponent` pass chosen props as attributes.
 *
 * `createComponent` binds every key found on the element's prototype as a DOM property, and a
 * property is never written into server markup. The widget starts its first flow when it
 * upgrades, before React hydrates, so the keys that define that flow must reach the browser as
 * attributes. This hides the given keys from that lookup: they are passed through as plain
 * attributes, server markup included, and the element still reads them as properties.
 *
 * On the server the standard HTML attributes (`id`, `title`, `slot`, `role` and so on) are hidden
 * too, so they are in the server markup. In the browser `createComponent` keeps them as it is,
 * because it removes such an attribute when its prop goes, which React 19 does not do for a
 * custom element.
 *
 * No element class is imported, because loading one needs a DOM and an edge runtime has none. In
 * the browser the prototype is the one of the class registered under the tag, looked up whenever a
 * prop is classified. On the server there is no class to ask, so a prop this wrapper passes is a
 * property unless it is hidden, a standard attribute or a kebab-case attribute name.
 *
 * @typeParam Tag - The widget tag the stand-in is for.
 * @param tag - The widget tag name.
 * @param keys - The prop names to pass as attributes instead of properties.
 * @returns A stand-in element class with a `name` and a lazily answering `prototype`.
 * @throws Error when the stand-in cannot be built as an element class.
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
 * Returns the project coordinates as attributes, so they are in the server markup.
 *
 * The `project` handle stays a property too: it carries the publishable key and is what the
 * element prefers once React hands it over. The attributes are `project-id`, `proxy-path` and
 * `url`; each is `undefined`, and so omitted, when its source is unset.
 *
 * A handle with a publishable key writes none, because attributes cannot carry the key. A widget
 * that started from them would send its first request without the bearer the project needs, and
 * never retry. {@link ZitadelLogin} renders nothing for such a handle until it has mounted, so its
 * element is created with the handle already bound.
 *
 * @param props - The wrapper props that name the project.
 * @returns The attribute map to spread onto the element, empty for a handle with a key.
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
  },
});

const ZitadelSessionElementReact = createComponent({
  react: React,
  tagName: widgetTags.session,
  elementClass: asAttributes(widgetTags.session, "url"),
  events: {
    onZitadelSignout: eventName("zitadel-signout"),
  },
});

/**
 * Forwards a widget event's detail to an app callback.
 *
 * The callback's return value, from an async handler or a Qwik QRL, is registered on the detail's
 * `waitUntil`. The three navigating events (flow-complete, flow-redirect and signout) then wait
 * for it before the widget navigates, up to two seconds. Other events carry no `waitUntil`, so the
 * registration is a no-op for them. Nothing happens when the event is not a custom event or the
 * callback is unset.
 *
 * @typeParam Detail - The detail type of the event.
 * @param event - The DOM event the widget dispatched.
 * @param handler - The app callback, if one was passed.
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
 * The props of {@link ZitadelLogin}.
 *
 * It is the widget's own props and event callbacks, inherited from `@zitadel/sdk-core` and
 * documented there, plus the standard HTML attributes (`className`, `style`, `id`, `title`,
 * `slot`, `hidden`, `role`, `tabIndex`, `data-*` and `aria-*`), `children` and the two preview
 * props. Any other prop is ignored.
 */
export type ZitadelLoginProps = ZitadelLoginWidgetProps &
  ZitadelWidgetAttributes & {
    /**
     * The light-DOM content that fills the widget's slots, such as `attribution-trailing`.
     *
     * The widget props are framework-agnostic and carry no children, but a React host needs them
     * to fill the slots. Children are rendered inside the `<zitadel-login>` element and are not
     * part of the flow, so they never change what the widget submits.
     *
     * @defaultValue Unset: the widget renders its own content only.
     */
    children?: React.ReactNode;
    /**
     * The state the widget previews, for an operator surface that shows how a step looks.
     *
     * The flow starts as usual, then the element shows the served step in this state and submits
     * nothing. Use it in an admin tool that previews a project's sign-in, never on a page real
     * users sign in on.
     *
     * @defaultValue Unset: the widget runs the flow for real.
     */
    previewState?: ZitadelLoginElement["previewState"];
    /**
     * The terminal step the `success` preview paints.
     *
     * It is read only when {@link ZitadelLoginProps | previewState} is `success` and ignored for
     * every other state.
     *
     * @defaultValue Unset: the element paints its own `done` step.
     */
    previewSuccessStep?: string;
  };

/**
 * Renders the sign-in or sign-up flow as a React component that wraps the `<zitadel-login>`
 * widget.
 *
 * The component binds the project handle as a DOM property, or the discrete `projectId` and
 * `proxyPath` props as attributes, which is what puts them into server-rendered markup. It
 * forwards the widget's `zitadel-*` events as optional callbacks that receive the event's
 * `detail`. A callback for `zitadel-flow-complete`, `zitadel-flow-redirect` or `zitadel-signout`
 * may return a promise; the widget waits for it, up to two seconds, before it navigates.
 *
 * The attributes `purpose`, `flow-name`, `resume-flow-id`, `post-sign-in-url`, `project-id`,
 * `proxy-path` and `url` are written into server markup, because the widget starts its first flow
 * when it upgrades, before React hydrates. Passing them only as properties would start a default
 * flow first and then restart it. Because React 19 does not apply an object property while it
 * hydrates a server-rendered custom element, pass `projectId` and `proxyPath` as strings on a
 * server-rendered page and keep the handle for a client-side app.
 *
 * A project handle with a publishable key cannot travel as attributes, because the first request
 * would then lack the bearer key and never retry. For such a handle the component renders nothing
 * on the server and until it has mounted in the browser, so the element is created with the
 * handle already bound. Do not rely on its markup being present in the server render in that case.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-login>` element, so the upgraded web
 * component can be reached imperatively. The definition of the element registers only in the
 * browser, so on an edge runtime the import is a no-op and the tag is emitted without content.
 *
 * In a client-side app, build the handle with {@link configureZitadel} and pass it as `project`.
 * The app renders after configuration, so the prop is present when the element upgrades.
 *
 * @example
 * ```tsx
 * import { ZitadelLogin, configureZitadel } from "@zitadel/sdk-react";
 *
 * const project = configureZitadel({ projectId: "296547382910273", proxyPath: "/__nextgen" });
 *
 * export function LoginPage() {
 *   return <ZitadelLogin project={project} purpose="login" postSignInUrl="/" />;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // A server-rendered page passes plain strings so the markup carries them.
 * <ZitadelLogin projectId="296547382910273" proxyPath="/__nextgen" purpose="register" />
 * ```
 *
 * @see {@link ZitadelLoginProps}
 */
export const ZitadelLogin = React.forwardRef<ZitadelLoginElement, ZitadelLoginProps>(
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
        onZitadelFlowStep={onFlowStep && ((event) => withDetail(event, onFlowStep))}
        onZitadelFlowInput={onFlowInput && ((event) => withDetail(event, onFlowInput))}
        onZitadelFlowComplete={onFlowComplete && ((event) => withDetail(event, onFlowComplete))}
        onZitadelFlowRedirect={onFlowRedirect && ((event) => withDetail(event, onFlowRedirect))}
        onZitadelFlowError={onFlowError && ((event) => withDetail(event, onFlowError))}
      >
        {props.children}
      </ZitadelLoginElementReact>
    );
  },
);

ZitadelLogin.displayName = "ZitadelLogin";

/**
 * The props of {@link ZitadelLogout}.
 *
 * It is the widget's own props and its sign-out callback, inherited from `@zitadel/sdk-core` and
 * documented there, plus the standard HTML attributes (`className`, `style`, `id`, `title`,
 * `slot`, `hidden`, `role`, `tabIndex`, `data-*` and `aria-*`). Any other prop is ignored.
 */
export type ZitadelLogoutProps = ZitadelLogoutWidgetProps & ZitadelWidgetAttributes;

/**
 * Renders the sign-out control as a React component that wraps the `<zitadel-logout>` widget.
 *
 * The component binds the project handle as a DOM property, or the discrete `projectId` and
 * `proxyPath` props as attributes, and forwards the widget's `zitadel-signout` event as the
 * optional `onSignout` callback. Use it in an account menu or a profile page. A callback that
 * returns a promise delays the post-sign-out navigation until it settles, up to two seconds.
 *
 * With a project handle that carries a publishable key the component still renders its tag, but
 * without the project attributes, because attributes cannot carry the key. A forwarded `ref`
 * resolves to the underlying `<zitadel-logout>` element.
 *
 * @example
 * ```tsx
 * import { ZitadelLogout } from "@zitadel/sdk-react";
 *
 * export function AccountMenu() {
 *   return <ZitadelLogout projectId="296547382910273" postSignOutUrl="/" />;
 * }
 * ```
 *
 * @see {@link ZitadelLogoutProps}
 */
export const ZitadelLogout = React.forwardRef<ZitadelLogoutElement, ZitadelLogoutProps>(
  function ZitadelLogout({ onSignout, ...props }, ref) {
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
        onZitadelSignout={onSignout && ((event) => withDetail(event, onSignout))}
      />
    );
  },
);

ZitadelLogout.displayName = "ZitadelLogout";

/**
 * The props of {@link ZitadelSession}.
 *
 * It is the widget's own props and its sign-out callback, inherited from `@zitadel/sdk-core` and
 * documented there, plus the standard HTML attributes (`className`, `style`, `id`, `title`,
 * `slot`, `hidden`, `role`, `tabIndex`, `data-*` and `aria-*`). Any other prop is ignored.
 */
export type ZitadelSessionProps = ZitadelSessionWidgetProps & ZitadelWidgetAttributes;

/**
 * Renders the signed-in "signed in as" card with a sign-out action as a React component that
 * wraps the `<zitadel-session>` widget.
 *
 * The card reads the current session from the same-origin proxy path and shows who is signed in;
 * it shows nothing sensitive and never exposes the session token. Use it in a header or profile
 * page when the stock card is enough. To build your own UI from the same read, use
 * `useSession` instead.
 *
 * The component binds the project handle as a DOM property, or the discrete `projectId` and
 * `proxyPath` props as attributes, and forwards the widget's `zitadel-signout` event as the
 * optional `onSignout` callback. With a project handle that carries a publishable key the
 * component still renders its tag, without the project attributes. A forwarded `ref` resolves to
 * the underlying `<zitadel-session>` element.
 *
 * @example
 * ```tsx
 * import { ZitadelSession } from "@zitadel/sdk-react";
 *
 * export function Header() {
 *   return <ZitadelSession projectId="296547382910273" postSignOutUrl="/login" />;
 * }
 * ```
 *
 * @see {@link ZitadelSessionProps}
 */
export const ZitadelSession = React.forwardRef<ZitadelSessionElement, ZitadelSessionProps>(
  function ZitadelSession({ onSignout, ...props }, ref) {
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
        onZitadelSignout={onSignout && ((event) => withDetail(event, onSignout))}
      />
    );
  },
);

ZitadelSession.displayName = "ZitadelSession";
