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
// Registers <zitadel-login>, <zitadel-logout> and <zitadel-session> in the browser.
// The edge build of the components package has no elements, so this does nothing there.
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
 * Re-exported from `@zitadel/api/config` so an app wires the API client from this
 * one package: {@link configureZitadel} sets the project the SDK talks to,
 * {@link getApi} returns the configured client and {@link getZitadelConfig}
 * reads the configuration back.
 */
export { configureZitadel, getApi, getZitadelConfig };
export type { ZitadelConfig, ZitadelProject };
export type {
  CreateFlowBodyPurpose,
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowStepDetail,
  ZitadelLoginConfig,
  ZitadelLoginHandlers,
  ZitadelLogoutConfig,
  ZitadelLogoutHandlers,
  ZitadelNavigationDetail,
  ZitadelSessionConfig,
  ZitadelSessionHandlers,
  ZitadelSignoutDetail,
  ZitadelWidgetAttributes,
} from "./types.js";

// Re-exported so scaffolded apps can wire the business copy overlay without a
// direct @zitadel/components dependency (strict package managers reject those).
export { businessLocales } from "@zitadel/components";

/**
 * Assigns a widget config value as a DOM *property*. An `undefined` value is
 * assigned too, not skipped: the widget elements restore their own default when
 * a prop is unset, so a cleared prop (e.g. the session card's `heading`) goes
 * back to "Signed in as" instead of keeping its last value.
 *
 * Qwik 2 binds custom-element JSX props as *attributes* only — its client
 * renderer has no property-setting path for elements — and the widgets expose
 * their config as property-only members (`project`/`locales` are
 * `@property({ attribute: false })`) or as camelCase properties backed by
 * kebab-case attributes (`projectId` ↔ `project-id`). Neither survives Qwik's
 * lower-cased attribute binding, so all configuration is applied imperatively on
 * the element — see the `bind*Config` binders.
 */
function setProp<E extends Element, K extends keyof E>(
  el: E,
  key: K,
  value: E[K] | undefined,
): void {
  el[key] = value as E[K];
}

/**
 * The attribute-backed config, emitted declaratively in the JSX. Under SSR
 * (Qwik Router) the widget arrives as server-rendered markup and Qwik *resumes*
 * it rather than re-rendering, so the `ref` binder never runs and the
 * `useVisibleTask$` re-binds only after the widget has upgraded and rendered
 * "requires a configured project" (and booted a `login` flow on a register
 * page). Attributes are serialised into the SSR'd HTML, so the widget reads them
 * the instant it upgrades. Qwik renders lower-case kebab-case attributes
 * verbatim; `undefined` omits one, and a boolean attribute is present-or-absent.
 * The property binders still run on the client, so property-only config (the
 * full `project` handle, `locales`) is applied on top.
 */
type Attrs = Record<string, string | undefined>;

function projectAttrs(props: {
  readonly project?: ZitadelProject;
  readonly projectId?: string;
  readonly proxyPath?: string;
}): Attrs {
  return {
    "project-id": props.project?.projectId ?? props.projectId,
    "proxy-path": proxyPathAttr(props.project?.proxyPath ?? props.proxyPath),
    url: props.project?.url,
    // Browser-safe by construction (ADR 036), so it can ride in server markup.
    // Without it a resumed widget would start its first flow, or run an SSO
    // handoff exchange, with no bearer before the property handle is restored.
    "publishable-key": props.project?.publishableKey,
  };
}

/**
 * An explicit empty proxy path means "the origin root" (the API client strips
 * trailing slashes), but a widget treats an empty `proxy-path` attribute as
 * unset and falls back to `/__nextgen`. `/` survives that and normalizes to root.
 */
function proxyPathAttr(path: string | undefined): string | undefined {
  return path === "" ? "/" : path;
}

function flag(value: boolean | undefined): string | undefined {
  return value ? "" : undefined;
}

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

function logoutAttrs(props: ZitadelLogoutProps): Attrs {
  return {
    ...projectAttrs(props),
    "post-sign-out-url": props.postSignOutUrl,
    theme: props.theme,
  };
}

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

/** Applies the `<zitadel-login>` surface config to the element as DOM properties. */
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

/** Applies the `<zitadel-logout>` surface config to the element as DOM properties. */
function bindLogoutConfig(el: ZitadelLogoutElement, props: ZitadelLogoutProps): void {
  setProp(el, "project", props.project);
  setProp(el, "projectId", props.projectId);
  setProp(el, "proxyPath", proxyPathAttr(props.proxyPath));
  setProp(el, "postSignOutUrl", props.postSignOutUrl);
  setProp(el, "theme", props.theme);
}

/** Applies the `<zitadel-session>` surface config to the element as DOM properties. */
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
 * Forwards a widget event's detail to the app callback, and registers the
 * callback's returned promise — from an async handler or a Qwik QRL — on the
 * detail's `waitUntil`. The three navigating events (flow-complete,
 * flow-redirect, signout) then wait for it before the widget navigates; other
 * events carry no `waitUntil`, so the call is a no-op.
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
 * Turns the plain-callback handlers of the shared SPA contract into Qwik props:
 * every handler becomes an optional `QRL` and its name gets a `$` suffix
 * (`onFlowComplete` becomes `onFlowComplete$`).
 *
 * Qwik can only pass a function across the server/browser boundary as a QRL, a
 * lazily loaded and serializable reference, which is why the props carry the
 * `$` suffix. Deriving the prop set from `@zitadel/sdk-core` means it can never
 * drift from the events the widget emits: a new contract event surfaces here as
 * a new `on...$` prop with no change to this package.
 *
 * A QRL loads lazily and runs asynchronously, so the callback's promise is
 * registered with the event's `waitUntil` and the widget holds its navigation
 * until the callback settles. See {@link ZitadelNavigationDetail}.
 *
 * @typeParam H - A handler record from `@zitadel/sdk-core`, such as
 * {@link ZitadelLoginHandlers}.
 */
export type Qrlify<H> = {
  readonly [K in keyof H as `${K & string}$`]?: H[K] extends ((detail: infer D) => void) | undefined
    ? QRL<(detail: D) => void>
    : never;
};

/**
 * Props for {@link ZitadelLogin}: the shared {@link ZitadelLoginConfig}
 * surface, the standard HTML attributes ({@link ZitadelWidgetAttributes}), the
 * `on...$` QRL callbacks derived from {@link ZitadelLoginHandlers}, and `ref`.
 *
 * Supply the project through `project` (the {@link ZitadelProject} handle), or
 * through the discrete `projectId` and `proxyPath`; the widget uses whichever is
 * present. Every callback is a Qwik QRL and may be async: the widget waits for it
 * before it navigates (see {@link ZitadelNavigationDetail}).
 */
export type ZitadelLoginProps = ZitadelLoginConfig &
  ZitadelWidgetAttributes &
  Qrlify<ZitadelLoginHandlers> & {
    /**
     * Signal that receives the underlying `<zitadel-login>` element once it
     * mounts, for code that needs the element itself (to focus it or call its
     * methods). It mirrors React's `forwardRef`. Qwik cannot hand a ref to a
     * custom element any other way, and the component fills it next to its own
     * host signal, so event forwarding keeps working. Left unset, nothing is
     * exposed.
     */
    readonly ref?: Signal<ZitadelLoginElement | undefined>;
  };

/**
 * Qwik component that renders the `<zitadel-login>` sign-in widget: the whole
 * login flow in one element, driven by
 * the Zitadel flow API through the same-origin `/__nextgen` proxy.
 *
 * The element is written statically in the component's JSX, not built at render
 * time. Its attribute-backed configuration (`project-id`, `proxy-path`, `url`,
 * `publishable-key`, `purpose`, `flow-name`, `resume-flow-id` and the rest) is
 * emitted into the server-rendered markup, so a resumed widget can read it the
 * moment it upgrades. Property-only configuration (the full `project` handle,
 * `locales`) is applied in the browser: Qwik 2 binds custom-element props as
 * attributes only, so a `ref` callback assigns the DOM properties at mount,
 * before the widget's first render, and a `useVisibleTask$` re-applies them
 * whenever a prop changes and wires the native listeners that forward the
 * widget's `zitadel-*` events to the `on...$` callbacks.
 *
 * Use it on a login or register page, with `purpose` choosing which.
 *
 * @example
 * ```tsx
 * <ZitadelLogin
 *   project={{ projectId: "my-project", proxyPath: "/__nextgen" }}
 *   onFlowComplete$={async () => {
 *     await markSignedIn();
 *   }}
 * />
 * ```
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
 * Props for {@link ZitadelLogout}: the shared {@link ZitadelLogoutConfig}
 * surface, the standard HTML attributes ({@link ZitadelWidgetAttributes}), the
 * `on...$` QRL callbacks derived from {@link ZitadelLogoutHandlers}, and `ref`.
 *
 * Supply the project through `project` (the {@link ZitadelProject} handle), or
 * through the discrete `projectId` and `proxyPath`; the widget uses whichever is
 * present. `onSignout$` may be async: the widget waits for it before it
 * navigates (see {@link ZitadelNavigationDetail}).
 */
export type ZitadelLogoutProps = ZitadelLogoutConfig &
  ZitadelWidgetAttributes &
  Qrlify<ZitadelLogoutHandlers> & {
    /**
     * Signal that receives the underlying `<zitadel-logout>` element once it
     * mounts, for code that needs the element itself. It mirrors React's
     * `forwardRef`; the component fills it next to its own host signal, so event
     * forwarding keeps working. Left unset, nothing is exposed.
     */
    readonly ref?: Signal<ZitadelLogoutElement | undefined>;
  };

/**
 * Qwik component that renders the `<zitadel-logout>` widget: a sign-out button
 * that ends the session through the same-origin `/__nextgen` proxy and then
 * sends the browser to `postSignOutUrl`.
 *
 * Like {@link ZitadelLogin}, the element is static in the JSX, its
 * attribute-backed config rides in the server-rendered markup, and the
 * property-only config and the `zitadel-signout` listener are applied in the
 * browser. `onSignout$` may be async: the widget navigates only after it has
 * settled (or after a short timeout), so a lazily loaded QRL is not cut off by
 * the page unloading.
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
 * Props for {@link ZitadelSession}: the shared {@link ZitadelSessionConfig}
 * surface, the standard HTML attributes ({@link ZitadelWidgetAttributes}), the
 * `on...$` QRL callbacks derived from {@link ZitadelSessionHandlers}, and `ref`.
 *
 * Supply the project through `project` (the {@link ZitadelProject} handle), or
 * through the discrete `projectId` and `proxyPath`; the widget uses whichever is
 * present. `onSignout$` may be async: the widget waits for it before it
 * navigates (see {@link ZitadelNavigationDetail}).
 */
export type ZitadelSessionProps = ZitadelSessionConfig &
  ZitadelWidgetAttributes &
  Qrlify<ZitadelSessionHandlers> & {
    /**
     * Signal that receives the underlying `<zitadel-session>` element once it
     * mounts, for code that needs the element itself. It mirrors React's
     * `forwardRef`. Left unset, nothing is exposed.
     */
    readonly ref?: Signal<ZitadelSessionElement | undefined>;
  };

/**
 * Qwik component that renders the `<zitadel-session>` widget: the post-sign-in
 * "signed in as" card with a sign-out button.
 *
 * Like {@link ZitadelLogin}, the element is static in the JSX, its
 * attribute-backed config rides in the server-rendered markup, and the
 * property-only config and the `zitadel-signout` listener are applied in the
 * browser. `onSignout$` may be async: the widget navigates only after it has
 * settled (or after a short timeout).
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
