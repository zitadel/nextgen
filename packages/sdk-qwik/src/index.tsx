import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";
import type {
  ZitadelLoginConfig,
  ZitadelLoginHandlers,
  ZitadelLogoutConfig,
  ZitadelLogoutHandlers,
  ZitadelSessionConfig,
  ZitadelSessionHandlers,
} from "@zitadel/sdk-core/types";

// Installs the early event buffer before the elements register (and so before any
// of them can emit); keep it directly above the components import.
import "./early-events";
/*
 * Registers <zitadel-login>, <zitadel-logout> and <zitadel-session> in the browser.
 * The edge build of the components package has no elements, so this does nothing there.
 */
import "@zitadel/components";
import { component$, useSignal, useVisibleTask$, type QRL, type Signal } from "@qwik.dev/core";
import { standardAttributes } from "@zitadel/sdk-core/types";
import {
  configureZitadel,
  getApi,
  getZitadelConfig,
  type ZitadelConfig,
  type ZitadelProject,
} from "@zitadel/api/config";

import { listenWithReplay, WRAPPER_MARKER } from "./early-events";
import type { ZitadelWidgetAttributes } from "./types.js";

/**
 * Re-exports {@link configureZitadel}, {@link getApi} and {@link getZitadelConfig} from
 * `@zitadel/api/config`, so an app wires the API client from this one package.
 *
 * {@link configureZitadel} sets the project the SDK talks to and returns the project handle,
 * {@link getApi} returns the configured API client, and {@link getZitadelConfig} reads the
 * configuration back. They exist here so a Qwik app needs no direct dependency on
 * `@zitadel/api`, which strict package managers would otherwise require it to declare.
 *
 * @example
 * ```ts
 * import { configureZitadel } from "@zitadel/sdk-qwik";
 *
 * export const project = configureZitadel({ projectId: "my-project", proxyPath: "/__nextgen" });
 * ```
 */
export { configureZitadel, getApi, getZitadelConfig };
export type { ZitadelConfig, ZitadelProject };
export type {
  ZitadelFlowPurpose,
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
 * Assigns a widget config value to the element as a DOM property.
 *
 * An `undefined` value is assigned too, not skipped. The widget elements restore their own default
 * when a property is unset, so a cleared prop, for example the session card's heading, goes back
 * to "Signed in as" instead of keeping its last value.
 *
 * Qwik 2 binds custom-element JSX props as attributes only, because its client renderer has no
 * property-setting path for elements. The widgets expose their config as property-only members
 * (`project` and `locales` are not attribute-backed) or as camelCase properties backed by
 * kebab-case attributes (`projectId` and `project-id`). Neither survives Qwik's lower-cased
 * attribute binding, so all configuration is applied imperatively on the element by the binders.
 *
 * @typeParam E - The element type.
 * @typeParam K - A property key of the element.
 * @param el - The widget element to write to.
 * @param key - The property to assign.
 * @param value - The value to assign, or `undefined` to restore the element's default.
 */
function setProp<E extends Element, K extends keyof E>(
  el: E,
  key: K,
  value: E[K] | undefined,
): void {
  el[key] = value as E[K];
}

/**
 * The attribute-backed config of a widget, as a record from attribute name to value.
 *
 * It is emitted declaratively in the JSX. Under server rendering in Qwik Router the widget arrives
 * as server-rendered markup and Qwik resumes it instead of re-rendering, so the `ref` binder never
 * runs, and the visible task re-binds only after the widget has upgraded and rendered "requires a
 * configured project" (and booted a `login` flow on a register page). Attributes are serialized
 * into the server HTML, so the widget reads them the moment it upgrades.
 *
 * Qwik renders lower-case kebab-case attributes verbatim. An `undefined` value omits the
 * attribute, and a boolean attribute is present or absent. The property binders still run in the
 * browser, so property-only config (the full project handle, `locales`) is applied on top.
 */
type Attrs = Record<string, string | undefined>;

/**
 * Builds the project attributes shared by every widget.
 *
 * The project handle wins over the discrete `projectId` and `proxyPath` props when both are set.
 * The `publishable-key` attribute is browser-safe by design, so it can ride in server markup.
 * Without it a resumed widget would start its first flow, or run a single-sign-on handoff
 * exchange, with no bearer token before the property handle is restored in the browser.
 *
 * @param props - The project handle and the discrete project props.
 * @returns The project attributes, with unset values omitted.
 */
function projectAttrs(props: {
  readonly project?: ZitadelProject;
  readonly projectId?: string;
  readonly proxyPath?: string;
}): Attrs {
  return {
    "project-id": props.project?.projectId ?? props.projectId,
    "proxy-path": proxyPathAttr(props.project?.proxyPath ?? props.proxyPath),
    url: props.project?.url,
    // Browser-safe by construction, so it can ride in server markup.
    // Without it a resumed widget would start its first flow, or run an SSO
    // handoff exchange, with no bearer before the property handle is restored.
    "publishable-key": props.project?.publishableKey,
  };
}

/**
 * Maps a proxy path to the value its attribute must carry.
 *
 * An explicit empty proxy path means the origin root, because the API client strips trailing
 * slashes. A widget, however, treats an empty `proxy-path` attribute as unset and falls back to
 * `/__nextgen`. The value `/` survives that and normalizes to the root.
 *
 * @param path - The proxy path, or `undefined` when unset.
 * @returns `/` for an empty path, otherwise the path unchanged.
 */
function proxyPathAttr(path: string | undefined): string | undefined {
  return path === "" ? "/" : path;
}

/**
 * Maps a boolean prop to a boolean attribute value.
 *
 * @param value - The prop value.
 * @returns An empty string (attribute present) when `true`, otherwise `undefined` (omitted).
 */
function flag(value: boolean | undefined): string | undefined {
  return value ? "" : undefined;
}

/**
 * Builds the server-renderable attributes of the sign-in widget.
 *
 * The purpose defaults to `login`. The resume flow handle is emitted so a resumed widget boots
 * with it instead of starting a new flow.
 *
 * @param props - The sign-in props.
 * @returns The attributes, with unset values omitted.
 */
function loginAttrs(props: ZitadelLoginProps): Attrs {
  return {
    ...projectAttrs(props),
    purpose: props.purpose ?? "login",
    "flow-name": props.flowName,
    "post-sign-in-url": props.postSignInUrl,
    "force-post-sign-in-url": flag(props.forcePostSignInUrl),
    // Without it a resumed widget would boot with no handle and start a new flow.
    "resume-flow-id": props.resumeFlowId ?? undefined,
    variant: props.variant,
    theme: props.theme,
    "suppress-header": flag(props.suppressHeader),
    "suppress-password-toggle": flag(props.suppressPasswordToggle),
    lang: props.lang,
  };
}

/**
 * Builds the server-renderable attributes of the sign-out widget.
 *
 * @param props - The sign-out props.
 * @returns The attributes, with unset values omitted.
 */
function logoutAttrs(props: ZitadelLogoutProps): Attrs {
  return {
    ...projectAttrs(props),
    "post-sign-out-url": props.postSignOutUrl,
    theme: props.theme,
  };
}

/**
 * Builds the server-renderable attributes of the session widget.
 *
 * @param props - The session props.
 * @returns The attributes, with unset values omitted.
 */
function sessionAttrs(props: ZitadelSessionProps): Attrs {
  return {
    ...projectAttrs(props),
    "post-sign-out-url": props.postSignOutUrl,
    heading: props.heading,
    "logout-label": props.logoutLabel,
    variant: props.variant,
    theme: props.theme,
    "suppress-header": flag(props.suppressHeader),
  };
}

/**
 * Applies the `<zitadel-login>` configuration to the element as DOM properties.
 *
 * This is the only place property-only config, such as the project handle, reaches the widget.
 * It runs in the `ref` callback at mount and again in the visible task whenever a prop changes.
 *
 * Boolean props are written as concrete booleans and the resume flow handle as a concrete string.
 * An `undefined` value would not clear the old state, so going from a handle or from `true` back
 * to unset would keep the previous value.
 *
 * @param el - The widget element.
 * @param props - The props to apply.
 */
function bindLoginConfig(el: ZitadelLoginElement, props: ZitadelLoginProps): void {
  setProp(el, "project", props.project);
  setProp(el, "projectId", props.projectId);
  setProp(el, "proxyPath", proxyPathAttr(props.proxyPath));
  setProp(el, "purpose", props.purpose ?? "login");
  setProp(el, "flowName", props.flowName);
  setProp(el, "postSignInUrl", props.postSignInUrl);
  // A concrete boolean, for the reason `suppressPasswordToggle` gives below.
  setProp(el, "forcePostSignInUrl", props.forcePostSignInUrl === true);
  // A concrete string, not the raw prop: `setProp` skips `undefined`, so
  // going from a handle back to unset would otherwise keep the old handle.
  setProp(el, "resumeFlowId", props.resumeFlowId ?? "");
  setProp(el, "variant", props.variant);
  setProp(el, "theme", props.theme);
  setProp(el, "suppressHeader", props.suppressHeader);
  // A concrete boolean, not the raw prop: `setProp` skips `undefined`, so
  // going from `true` back to unset would otherwise leave the toggle hidden.
  setProp(el, "suppressPasswordToggle", props.suppressPasswordToggle === true);
  setProp(el, "locales", props.locales);
  setProp(el, "lang", props.lang);
}

/**
 * Applies the `<zitadel-logout>` configuration to the element as DOM properties.
 *
 * This is the only place property-only config, such as the project handle, reaches the widget.
 * It runs in the `ref` callback at mount and again in the visible task whenever a prop changes.
 * @param el - The widget element.
 * @param props - The props to apply.
 */
function bindLogoutConfig(el: ZitadelLogoutElement, props: ZitadelLogoutProps): void {
  setProp(el, "project", props.project);
  setProp(el, "projectId", props.projectId);
  setProp(el, "proxyPath", proxyPathAttr(props.proxyPath));
  setProp(el, "postSignOutUrl", props.postSignOutUrl);
  setProp(el, "theme", props.theme);
}

/**
 * Applies the `<zitadel-session>` configuration to the element as DOM properties.
 *
 * This is the only place property-only config, such as the project handle, reaches the widget.
 * It runs in the `ref` callback at mount and again in the visible task whenever a prop changes.
 * @param el - The widget element.
 * @param props - The props to apply.
 */
function bindSessionConfig(el: ZitadelSessionElement, props: ZitadelSessionProps): void {
  setProp(el, "project", props.project);
  setProp(el, "projectId", props.projectId);
  setProp(el, "proxyPath", proxyPathAttr(props.proxyPath));
  setProp(el, "postSignOutUrl", props.postSignOutUrl);
  setProp(el, "heading", props.heading);
  setProp(el, "logoutLabel", props.logoutLabel);
  setProp(el, "variant", props.variant);
  setProp(el, "theme", props.theme);
  setProp(el, "suppressHeader", props.suppressHeader);
}

/**
 * Forwards a widget event's detail to the app callback and registers the callback's promise on the
 * detail's `waitUntil`.
 *
 * The callback is a Qwik QRL, which loads lazily and runs asynchronously, and the three navigating
 * events (`zitadel-flow-complete`, `zitadel-flow-redirect` and `zitadel-signout`) are followed
 * immediately by a page navigation. Registering the returned promise makes the widget wait for the
 * callback, for at most two seconds, before it navigates, so a callback is not cut off by the page
 * unloading. Other events carry no `waitUntil`, so for them the registration is skipped. A callback
 * that returns nothing delays nothing, and a rejected promise does not block the navigation.
 *
 * @typeParam Detail - The event detail type the handler receives.
 * @param event - The widget event. Anything that is not a `CustomEvent` is ignored.
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
 * Turns the plain-callback handlers of the shared single-page-app contract into Qwik props.
 *
 * Every handler becomes an optional QRL and its name gets a `$` suffix, so `onFlowComplete`
 * becomes `onFlowComplete$`. Qwik can pass a function across the server and browser boundary only
 * as a QRL, a lazily loaded and serializable reference, which is why the props carry the suffix.
 * Deriving the prop set from the handlers in `@zitadel/sdk-core` means it cannot drift from the
 * events the widget emits: a new event in the contract surfaces here as a new `on...$` prop with no
 * change to this package.
 *
 * A QRL loads lazily and runs asynchronously, so the wrapper registers the callback's promise on
 * the event's `waitUntil`, and the widget holds its navigation until the callback settles.
 *
 * @typeParam H - A handler record from `@zitadel/sdk-core`, such as `ZitadelLoginHandlers`.
 */
type Qrlify<H> = {
  readonly [K in keyof H as `${K & string}$`]?: H[K] extends ((detail: infer D) => void) | undefined
    ? QRL<(detail: D) => void>
    : never;
};

/**
 * The props of {@link ZitadelLogin}.
 *
 * It combines the shared sign-in configuration from `@zitadel/sdk-core`, the standard HTML
 * attributes, the `on...$` QRL callbacks derived from the sign-in handlers, and {@link ZitadelLoginProps | ref}.
 *
 * Supply the project through `project` (the project handle that {@link configureZitadel}
 * returns), or through the discrete `projectId` and `proxyPath` props. The widget uses whichever
 * is present, and the handle wins when both are set. Every callback is a Qwik QRL and may be
 * async: the widget waits for it, for at most two seconds, before it navigates.
 *
 * @example
 * ```tsx
 * const props: ZitadelLoginProps = {
 *   project,
 *   purpose: "register",
 *   onFlowComplete$: $(async (detail) => {
 *     await exchangeHandoff(detail.handoff_token);
 *   }),
 * };
 * ```
 */
export type ZitadelLoginProps = ZitadelLoginConfig &
  ZitadelWidgetAttributes &
  Qrlify<ZitadelLoginHandlers> & {
    /**
     * A signal that receives the underlying `<zitadel-login>` element once it mounts.
     *
     * Use it for code that needs the element itself, for example to focus it or call its methods.
     * It plays the role of a forwarded ref in other frameworks: Qwik cannot hand a ref to a custom
     * element any other way, and the component fills the signal next to its own host signal, so
     * event forwarding keeps working. The value is `undefined` until the element mounts, and on
     * the server. Left unset, nothing is exposed.
     *
     * @example
     * ```tsx
     * const login = useSignal<HTMLElement>();
     * <ZitadelLogin project={project} ref={login} />;
     * ```
     */
    readonly ref?: Signal<ZitadelLoginElement | undefined>;
  };

/**
 * Renders the `<zitadel-login>` sign-in widget: the whole login flow in one element, driven by the
 * Zitadel flow API through the same-origin proxy path.
 *
 * Use it on a login or register page, with `purpose` choosing which. For a bare sign-out button
 * use {@link ZitadelLogout}, and for a signed-in card use {@link ZitadelSession}.
 *
 * The element is written statically in the component's JSX, not built at render time. Its
 * attribute-backed configuration (`project-id`, `proxy-path`, `url`, `publishable-key`, `purpose`,
 * `flow-name`, `resume-flow-id` and the rest) is emitted into the server-rendered markup, so a
 * resumed widget can read it the moment it upgrades. The publishable key is browser-safe by
 * design. Property-only configuration (the full project handle, `locales`) is applied in the
 * browser: Qwik 2 binds custom-element props as attributes only, so a `ref` callback assigns the
 * DOM properties at mount, before the widget's first render, and a visible task re-applies them
 * whenever a prop changes and wires the native listeners that forward the widget's `zitadel-*`
 * events to the `on...$` callbacks.
 *
 * Callbacks are QRLs, which load lazily. For `onFlowComplete$` and `onFlowRedirect$` the wrapper
 * hands the callback's promise to the event's `waitUntil`, so the widget waits for it before it
 * navigates. Terminal events that fire before the listeners attach, which happens when the widget
 * boots from a resume flow handle under server rendering, are buffered and replayed in order, so a
 * callback such as a handoff-token exchange is not missed. Input events are never buffered because
 * they can carry passwords.
 *
 * The element is defined only in the browser. On the server, and on edge runtimes without a DOM,
 * the component renders the unknown tag with its attributes.
 *
 * @example
 * ```tsx
 * import { $ } from "@qwik.dev/core";
 * import { ZitadelLogin } from "@zitadel/sdk-qwik";
 *
 * export default () => (
 *   <ZitadelLogin
 *     project={{ projectId: "my-project", proxyPath: "/__nextgen" }}
 *     onFlowComplete$={async () => {
 *       await markSignedIn();
 *     }}
 *   />
 * );
 * ```
 *
 * @see {@link ZitadelLoginProps}
 */
export const ZitadelLogin = component$<ZitadelLoginProps>((props) => {
  // The standard HTML attributes are the only extra props the element takes.
  const attributes = standardAttributes(props);
  const host = useSignal<ZitadelLoginElement>();
  // biome-ignore lint/correctness/noQwikUseVisibleTask: wrapping a web component needs an imperative mount task to set DOM properties and wire native listeners Qwik's declarative APIs cannot express.
  useVisibleTask$(
    ({ track, cleanup }) => {
      const el = track(() => host.value);
      if (!el) {
        return;
      }
      // Re-run whenever any prop changes, then re-apply the config reactively.
      track(() => ({ ...props }));
      bindLoginConfig(el, props);
      const onStep = (event: Event): void => withDetail(event, props.onFlowStep$);
      const onInput = (event: Event): void => withDetail(event, props.onFlowInput$);
      const onComplete = (event: Event): void => withDetail(event, props.onFlowComplete$);
      const onRedirect = (event: Event): void => withDetail(event, props.onFlowRedirect$);
      const onError = (event: Event): void => withDetail(event, props.onFlowError$);
      cleanup(
        listenWithReplay(el, {
          "zitadel-flow-step": onStep,
          "zitadel-flow-input": onInput,
          "zitadel-flow-complete": onComplete,
          "zitadel-flow-redirect": onRedirect,
          "zitadel-flow-error": onError,
        }),
      );
    },
    { strategy: "document-ready" },
  );
  return (
    <zitadel-login
      {...attributes}
      {...{ [WRAPPER_MARKER]: "" }}
      ref={(el) => {
        host.value = el;
        if (props.ref) {
          props.ref.value = el;
        }
        bindLoginConfig(el, props);
      }}
      {...loginAttrs(props)}
    />
  );
});

/**
 * The props of {@link ZitadelLogout}.
 *
 * It combines the shared sign-out configuration from `@zitadel/sdk-core`, the standard HTML
 * attributes, the `onSignout$` QRL callback, and {@link ZitadelLogoutProps | ref}.
 *
 * Supply the project through `project` (the project handle that {@link configureZitadel}
 * returns), or through the discrete `projectId` and `proxyPath` props. The widget uses whichever
 * is present, and the handle wins when both are set. `onSignout$` may be async: the widget waits
 * for it, for at most two seconds, before it navigates.
 */
export type ZitadelLogoutProps = ZitadelLogoutConfig &
  ZitadelWidgetAttributes &
  Qrlify<ZitadelLogoutHandlers> & {
    /**
     * A signal that receives the underlying `<zitadel-logout>` element once it mounts.
     *
     * Use it for code that needs the element itself. It plays the role of a forwarded ref in other
     * frameworks, and the component fills the signal next to its own host signal, so event
     * forwarding keeps working. The value is `undefined` until the element mounts, and on the
     * server. Left unset, nothing is exposed.
     */
    readonly ref?: Signal<ZitadelLogoutElement | undefined>;
  };

/**
 * Renders the `<zitadel-logout>` widget: a sign-out button that ends the session through the
 * same-origin proxy path and then sends the browser to `postSignOutUrl`.
 *
 * Use it wherever a bare "Sign out" action is enough. To also show who is signed in, use
 * {@link ZitadelSession}.
 *
 * Like {@link ZitadelLogin}, the element is static in the JSX, its attribute-backed config rides in
 * the server-rendered markup, and the property-only config and the `zitadel-signout` listener are
 * applied in the browser. `onSignout$` may be async: the widget navigates only after the callback
 * has settled, or after a two-second timeout, so a lazily loaded QRL is not cut off by the page
 * unloading. A signout event that fires before the listener attaches is buffered and replayed.
 *
 * @example
 * ```tsx
 * import { ZitadelLogout } from "@zitadel/sdk-qwik";
 *
 * export default () => (
 *   <ZitadelLogout project={project} postSignOutUrl="/login" onSignout$={async () => clearCache()} />
 * );
 * ```
 *
 * @see {@link ZitadelLogoutProps}
 */
export const ZitadelLogout = component$<ZitadelLogoutProps>((props) => {
  // The standard HTML attributes are the only extra props the element takes.
  const attributes = standardAttributes(props);
  const host = useSignal<ZitadelLogoutElement>();
  // biome-ignore lint/correctness/noQwikUseVisibleTask: wrapping a web component needs an imperative mount task to set DOM properties and wire native listeners Qwik's declarative APIs cannot express.
  useVisibleTask$(
    ({ track, cleanup }) => {
      const el = track(() => host.value);
      if (!el) {
        return;
      }
      track(() => ({ ...props }));
      bindLogoutConfig(el, props);
      const onSignout = (event: Event): void => withDetail(event, props.onSignout$);
      cleanup(listenWithReplay(el, { "zitadel-signout": onSignout }));
    },
    { strategy: "document-ready" },
  );
  return (
    <zitadel-logout
      {...attributes}
      {...{ [WRAPPER_MARKER]: "" }}
      ref={(el) => {
        host.value = el;
        if (props.ref) {
          props.ref.value = el;
        }
        bindLogoutConfig(el, props);
      }}
      {...logoutAttrs(props)}
    />
  );
});

/**
 * The props of {@link ZitadelSession}.
 *
 * It combines the shared session configuration from `@zitadel/sdk-core`, the standard HTML
 * attributes, the `onSignout$` QRL callback, and {@link ZitadelSessionProps | ref}.
 *
 * Supply the project through `project` (the project handle that {@link configureZitadel}
 * returns), or through the discrete `projectId` and `proxyPath` props. The widget uses whichever
 * is present, and the handle wins when both are set. `onSignout$` may be async: the widget waits
 * for it, for at most two seconds, before it navigates.
 */
export type ZitadelSessionProps = ZitadelSessionConfig &
  ZitadelWidgetAttributes &
  Qrlify<ZitadelSessionHandlers> & {
    /**
     * A signal that receives the underlying `<zitadel-session>` element once it mounts.
     *
     * Use it for code that needs the element itself. The value is `undefined` until the element
     * mounts, and on the server. Left unset, nothing is exposed.
     */
    readonly ref?: Signal<ZitadelSessionElement | undefined>;
  };

/**
 * Renders the `<zitadel-session>` widget: the post-sign-in "signed in as" card with a sign-out
 * button.
 *
 * Use it on pages that confirm who is signed in. For a bare sign-out button use
 * {@link ZitadelLogout}.
 *
 * Like {@link ZitadelLogin}, the element is static in the JSX, its attribute-backed config rides in
 * the server-rendered markup, and the property-only config and the `zitadel-signout` listener are
 * applied in the browser. `onSignout$` may be async: the widget navigates only after the callback
 * has settled, or after a two-second timeout. A signout event that fires before the listener
 * attaches is buffered and replayed.
 *
 * @example
 * ```tsx
 * import { ZitadelSession } from "@zitadel/sdk-qwik";
 *
 * export default () => <ZitadelSession project={project} heading="Welcome back" />;
 * ```
 *
 * @see {@link ZitadelSessionProps}
 */
export const ZitadelSession = component$<ZitadelSessionProps>((props) => {
  // The standard HTML attributes are the only extra props the element takes.
  const attributes = standardAttributes(props);
  const host = useSignal<ZitadelSessionElement>();
  // biome-ignore lint/correctness/noQwikUseVisibleTask: wrapping a web component needs an imperative mount task to set DOM properties and wire native listeners Qwik's declarative APIs cannot express.
  useVisibleTask$(
    ({ track, cleanup }) => {
      const el = track(() => host.value);
      if (!el) {
        return;
      }
      track(() => ({ ...props }));
      bindSessionConfig(el, props);
      const onSignout = (event: Event): void => withDetail(event, props.onSignout$);
      cleanup(listenWithReplay(el, { "zitadel-signout": onSignout }));
    },
    { strategy: "document-ready" },
  );
  return (
    <zitadel-session
      {...attributes}
      {...{ [WRAPPER_MARKER]: "" }}
      ref={(el) => {
        host.value = el;
        if (props.ref) {
          props.ref.value = el;
        }
        bindSessionConfig(el, props);
      }}
      {...sessionAttrs(props)}
    />
  );
});
