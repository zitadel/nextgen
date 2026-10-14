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

import "@zitadel/components";
import {
  component$,
  Slot,
  useSignal,
  useVisibleTask$,
  type QRL,
  type Signal,
} from "@qwik.dev/core";
import {
  configureZitadel,
  getApi,
  getZitadelConfig,
  type ZitadelConfig,
  type ZitadelProject,
} from "@zitadel/api/config";

export { configureZitadel, getApi, getZitadelConfig };
export type { ZitadelConfig, ZitadelProject };
export * from "./types";

// Re-exported so scaffolded apps can wire the business copy overlay without a
// direct @zitadel/components dependency (strict package managers reject those).
export { businessLocales } from "@zitadel/components";

/**
 * Assigns a widget config value as a DOM *property*, `undefined` included: the
 * widgets treat `undefined` as "use the default", so a prop the parent clears
 * resets the element (e.g. the session card's "Signed in as" heading), and a
 * property-only member (`project`, `locales`) is dropped rather than kept stale.
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
 * (Qwik Router) the widget arrives as server-rendered markup that Qwik
 * *resumes* rather than re-renders. The `ref` binder does run on the server,
 * but there it receives a `DomRef` placeholder, not the element: it stores that
 * ref in the host signal (which serialises), and on resume the
 * `useVisibleTask$` reads the real element from it and applies the properties
 * and listeners. That happens only after the widget has upgraded, so the
 * attributes are what it boots from: they are serialised into the SSR'd HTML
 * and read the instant it upgrades (otherwise it would render "requires a
 * configured project", or boot a `login` flow on a register page). Qwik renders
 * lower-case kebab-case attributes verbatim; `undefined` omits one, and a
 * boolean attribute is present-or-absent. Property-only config (the full
 * `project` handle, `locales`) is applied on top by the visible task.
 */
type Attrs = Record<string, string | undefined>;

function projectAttrs(props: {
  readonly project?: ZitadelProject;
  readonly projectId?: string;
  readonly proxyPath?: string;
}): Attrs {
  return {
    "project-id": props.project?.projectId ?? props.projectId,
    "proxy-path": props.project?.proxyPath ?? props.proxyPath,
    url: props.project?.url,
  };
}

function flag(value: boolean | undefined): string | undefined {
  return value ? "" : undefined;
}

function loginAttrs(props: ZitadelLoginProps): Attrs {
  return {
    ...projectAttrs(props),
    purpose: props.purpose,
    "flow-name": props.flowName,
    "post-sign-in-url": props.postSignInUrl,
    variant: props.variant,
    theme: props.theme,
    "suppress-header": flag(props.suppressHeader),
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
  setProp(el, "proxyPath", props.proxyPath);
  setProp(el, "purpose", props.purpose);
  setProp(el, "flowName", props.flowName);
  setProp(el, "postSignInUrl", props.postSignInUrl);
  setProp(el, "variant", props.variant);
  setProp(el, "theme", props.theme);
  setProp(el, "suppressHeader", props.suppressHeader);
  setProp(el, "locales", props.locales);
  setProp(el, "lang", props.lang);
}

/** Applies the `<zitadel-logout>` surface config to the element as DOM properties. */
function bindLogoutConfig(el: ZitadelLogoutElement, props: ZitadelLogoutProps): void {
  setProp(el, "project", props.project);
  setProp(el, "projectId", props.projectId);
  setProp(el, "proxyPath", props.proxyPath);
  setProp(el, "postSignOutUrl", props.postSignOutUrl);
  setProp(el, "theme", props.theme);
}

/** Applies the `<zitadel-session>` surface config to the element as DOM properties. */
function bindSessionConfig(el: ZitadelSessionElement, props: ZitadelSessionProps): void {
  setProp(el, "project", props.project);
  setProp(el, "projectId", props.projectId);
  setProp(el, "proxyPath", props.proxyPath);
  setProp(el, "postSignOutUrl", props.postSignOutUrl);
  setProp(el, "heading", props.heading);
  setProp(el, "logoutLabel", props.logoutLabel);
  setProp(el, "variant", props.variant);
  setProp(el, "theme", props.theme);
  setProp(el, "suppressHeader", props.suppressHeader);
}

function eventDetail<T>(event: Event): T {
  return (event as CustomEvent<T>).detail;
}

type Handler = QRL<(detail: never) => void> | undefined;

/**
 * Calls a handler QRL with the event's detail. A resolved QRL runs
 * synchronously, like the other SDKs' callbacks: the widget navigates right
 * after emitting `zitadel-signout`, `zitadel-flow-redirect` or a redirecting
 * `zitadel-flow-complete`, so a handler that only started later would run after
 * the page is already leaving. One still loading runs once it has loaded: late,
 * but never dropped.
 */
function forward(handler: Handler, event: Event): void {
  if (!handler) {
    return;
  }
  const detail = eventDetail<never>(event);
  const run = handler.resolved;
  if (run) {
    run(detail);
    return;
  }
  void handler.resolve().then((loaded) => loaded(detail));
}

/** Starts loading the handler QRLs now, so each is usually resolved before its event fires. */
function preload(handlers: readonly Handler[]): void {
  for (const handler of handlers) {
    void handler?.resolve().catch(() => undefined);
  }
}

/** The latest props each wired element forwards to, so a re-render never re-attaches. */
const wiredProps = new WeakMap<Element, object>();

/**
 * Attaches the native `zitadel-*` listeners, once per element and
 * synchronously. The widget starts its flow as soon as it upgrades, so a
 * listener attached only after the handler chunks load would miss the first
 * `zitadel-flow-step`, or a startup `zitadel-flow-error`. Each listener reads
 * the props current at dispatch time, so a re-render that swaps a handler needs
 * no re-attach. Called from the `ref` binder (client renders) and from the
 * visible task (resumed server markup, where the `ref` binder ran on the server
 * against a placeholder rather than the element).
 */
function wire<P extends object>(
  el: Element,
  props: P,
  listeners: Readonly<Record<string, (props: P, event: Event) => void>>,
): void {
  if (typeof (el as Partial<Element>).addEventListener !== "function") {
    return;
  }
  const wired = wiredProps.has(el);
  wiredProps.set(el, props);
  if (wired) {
    return;
  }
  for (const [name, listener] of Object.entries(listeners)) {
    el.addEventListener(name, (event) => listener(wiredProps.get(el) as P, event));
  }
}

const LOGIN_LISTENERS = {
  "zitadel-flow-step": (props: ZitadelLoginProps, event: Event): void =>
    forward(props.onFlowStep$, event),
  "zitadel-flow-input": (props: ZitadelLoginProps, event: Event): void =>
    forward(props.onFlowInput$, event),
  "zitadel-flow-complete": (props: ZitadelLoginProps, event: Event): void =>
    forward(props.onFlowComplete$, event),
  "zitadel-flow-redirect": (props: ZitadelLoginProps, event: Event): void =>
    forward(props.onFlowRedirect$, event),
  "zitadel-flow-error": (props: ZitadelLoginProps, event: Event): void =>
    forward(props.onFlowError$, event),
};

type SignedInProps = ZitadelLogoutProps | ZitadelSessionProps;

const SESSION_LISTENERS = {
  "zitadel-signout": (props: SignedInProps, event: Event): void => forward(props.onSignout$, event),
  "zitadel-session-missing": (props: SignedInProps, event: Event): void =>
    forward(props.onSessionMissing$, event),
  "zitadel-session-error": (props: SignedInProps, event: Event): void =>
    forward(props.onSessionError$, event),
};

function loginHandlers(props: ZitadelLoginProps): Handler[] {
  return [
    props.onFlowStep$,
    props.onFlowInput$,
    props.onFlowComplete$,
    props.onFlowRedirect$,
    props.onFlowError$,
  ];
}

function sessionHandlers(props: SignedInProps): Handler[] {
  return [props.onSignout$, props.onSessionMissing$, props.onSessionError$];
}

/**
 * Wraps each plain-callback handler from the shared SPA contract in a Qwik
 * {@link QRL} and suffixes the prop name with `$`, so the Qwik prop set is
 * derived from `@zitadel/sdk-core` and can never drift from the events the
 * widget emits. Adding a contract event surfaces a new `on…$` QRL prop here.
 */
type Qrlify<H> = {
  readonly [K in keyof H as `${K & string}$`]?: H[K] extends ((detail: infer D) => void) | undefined
    ? QRL<(detail: D) => void>
    : never;
};

/**
 * Props for {@link ZitadelLogin}. Supply the SDK handle via {@link project}, or
 * the discrete `projectId` / `proxyPath` the widget reads as properties — the
 * widget uses whichever is present. The `on…$` QRL callbacks are derived from
 * the shared {@link ZitadelLoginHandlers} contract. Pass an optional {@link ref}
 * signal to obtain the underlying `<zitadel-login>` element imperatively.
 */
export type ZitadelLoginProps = ZitadelLoginConfig &
  Qrlify<ZitadelLoginHandlers> & {
    /**
     * Optional signal populated with the underlying `<zitadel-login>` element
     * once it mounts, mirroring React's `forwardRef`. Wired alongside the
     * component's internal host signal, so event forwarding stays intact.
     */
    readonly ref?: Signal<ZitadelLoginElement | undefined>;
  };

/**
 * Qwik component wrapping the `<zitadel-login>` web component. Binds the
 * {@link ZitadelProject} handle (or the discrete project id / proxy path) and
 * the surface config as DOM properties — Qwik's JSX cannot set these on a custom
 * element (see {@link setProp}). On a client render the `ref` callback applies
 * them as soon as the element exists; under SSR the `ref` binder only ran on the
 * server, so the widget boots from its attributes and may start its flow before
 * the resumed visible task applies the properties. The element compares the
 * project it resolves, not the channel it came through, so the same project
 * arriving as attributes and then as a handle does not start a second flow. The
 * `useVisibleTask$` tracks the props and re-applies them when any changes, and
 * the native listeners forward the widget's `zitadel-*` events, which Qwik's
 * declarative `useOn` does not catch.
 */
export const ZitadelLogin = component$<ZitadelLoginProps>((props) => {
  const host = useSignal<ZitadelLoginElement>();
  // biome-ignore lint/correctness/noQwikUseVisibleTask: wrapping a web component needs an imperative mount task to set DOM properties and wire native listeners Qwik's declarative APIs cannot express.
  useVisibleTask$(
    ({ track }) => {
      const el = track(() => host.value);
      if (!el) {
        return;
      }
      // Re-run whenever any prop changes, then re-apply the config reactively.
      track(() => ({ ...props }));
      bindLoginConfig(el, props);
      wire(el, props, LOGIN_LISTENERS);
      preload(loginHandlers(props));
    },
    { strategy: "document-ready" },
  );
  return (
    <zitadel-login
      ref={(el) => {
        host.value = el;
        if (props.ref) {
          props.ref.value = el;
        }
        bindLoginConfig(el, props);
        wire(el, props, LOGIN_LISTENERS);
      }}
      {...loginAttrs(props)}
    >
      <Slot />
    </zitadel-login>
  );
});

/**
 * Props for {@link ZitadelLogout}. Supply the SDK handle via {@link project}, or
 * the discrete `projectId` / `proxyPath` the widget reads as properties — the
 * widget uses whichever is present. The `on…$` QRL callbacks are derived from
 * the shared {@link ZitadelLogoutHandlers} contract. Pass an optional {@link ref}
 * signal to obtain the underlying `<zitadel-logout>` element imperatively.
 */
export type ZitadelLogoutProps = ZitadelLogoutConfig &
  Qrlify<ZitadelLogoutHandlers> & {
    /**
     * Optional signal populated with the underlying `<zitadel-logout>` element
     * once it mounts, mirroring React's `forwardRef`. Wired alongside the
     * component's internal host signal, so event forwarding stays intact.
     */
    readonly ref?: Signal<ZitadelLogoutElement | undefined>;
  };

/**
 * Qwik component wrapping the `<zitadel-logout>` web component. Binds the
 * {@link ZitadelProject} handle (or the discrete project id / proxy path) and
 * surface config as DOM properties (see {@link setProp}) — applied at mount in
 * the `ref` callback and re-applied reactively by the `useVisibleTask$` — and
 * forwards the widget's `zitadel-signout`, `zitadel-session-missing` and
 * `zitadel-session-error` events as optional callbacks.
 */
export const ZitadelLogout = component$<ZitadelLogoutProps>((props) => {
  const host = useSignal<ZitadelLogoutElement>();
  // biome-ignore lint/correctness/noQwikUseVisibleTask: wrapping a web component needs an imperative mount task to set DOM properties and wire native listeners Qwik's declarative APIs cannot express.
  useVisibleTask$(
    ({ track }) => {
      const el = track(() => host.value);
      if (!el) {
        return;
      }
      track(() => ({ ...props }));
      bindLogoutConfig(el, props);
      wire(el, props, SESSION_LISTENERS);
      preload(sessionHandlers(props));
    },
    { strategy: "document-ready" },
  );
  return (
    <zitadel-logout
      ref={(el) => {
        host.value = el;
        if (props.ref) {
          props.ref.value = el;
        }
        bindLogoutConfig(el, props);
        wire(el, props, SESSION_LISTENERS);
      }}
      {...logoutAttrs(props)}
    >
      <Slot />
    </zitadel-logout>
  );
});

/**
 * Props for {@link ZitadelSession}. Supply the SDK handle via {@link project},
 * or the discrete `projectId` / `proxyPath` the widget reads as properties. The
 * `on…$` QRL callbacks are derived from the shared {@link ZitadelSessionHandlers}
 * contract. Pass an optional {@link ref} signal to obtain the underlying
 * `<zitadel-session>` element imperatively.
 */
export type ZitadelSessionProps = ZitadelSessionConfig &
  Qrlify<ZitadelSessionHandlers> & {
    /**
     * Optional signal populated with the underlying `<zitadel-session>` element
     * once it mounts, mirroring React's `forwardRef`.
     */
    readonly ref?: Signal<ZitadelSessionElement | undefined>;
  };

/**
 * Qwik component wrapping the `<zitadel-session>` web component — the
 * post-sign-in "signed in as" card. Binds the {@link ZitadelProject} handle (or
 * the discrete project id / proxy path) and surface config as DOM properties
 * (see {@link setProp}) — applied at mount in the `ref` callback and re-applied
 * reactively by the `useVisibleTask$` — and forwards the widget's
 * `zitadel-signout`, `zitadel-session-missing` and `zitadel-session-error` events
 * as optional callbacks.
 */
export const ZitadelSession = component$<ZitadelSessionProps>((props) => {
  const host = useSignal<ZitadelSessionElement>();
  // biome-ignore lint/correctness/noQwikUseVisibleTask: wrapping a web component needs an imperative mount task to set DOM properties and wire native listeners Qwik's declarative APIs cannot express.
  useVisibleTask$(
    ({ track }) => {
      const el = track(() => host.value);
      if (!el) {
        return;
      }
      track(() => ({ ...props }));
      bindSessionConfig(el, props);
      wire(el, props, SESSION_LISTENERS);
      preload(sessionHandlers(props));
    },
    { strategy: "document-ready" },
  );
  return (
    <zitadel-session
      ref={(el) => {
        host.value = el;
        if (props.ref) {
          props.ref.value = el;
        }
        bindSessionConfig(el, props);
        wire(el, props, SESSION_LISTENERS);
      }}
      {...sessionAttrs(props)}
    >
      <Slot />
    </zitadel-session>
  );
});
