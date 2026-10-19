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
import "@zitadel/components";
import {
  component$,
  useSignal,
  useVisibleTask$,
  type ClassList,
  type HTMLElementAttrs,
  type QRL,
  type Signal,
} from "@qwik.dev/core";
import { type StandardAttributeProps, standardAttributes } from "@zitadel/sdk-core/types";
import {
  configureZitadel,
  getApi,
  getZitadelConfig,
  type ZitadelConfig,
  type ZitadelProject,
} from "@zitadel/api/config";

import { listenWithReplay, WRAPPER_MARKER } from "./early-events";

export { configureZitadel, getApi, getZitadelConfig };
export type { ZitadelConfig, ZitadelProject };
export * from "./types";

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
 * The standard HTML attributes a widget wrapper accepts besides its own props,
 * and nothing else, so no prop the type accepts is dropped. They are passed to
 * the widget element.
 */
export type ZitadelWidgetAttributes = StandardAttributeProps<
  HTMLElementAttrs & { class?: ClassList }
>;

function eventDetail<T>(event: Event): T {
  return (event as CustomEvent<T>).detail;
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
  ZitadelWidgetAttributes &
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
 * element (see {@link setProp}). The `ref` callback applies them synchronously at
 * mount, before the widget's first render; the `useVisibleTask$` tracks the props
 * and re-applies them when any changes (so the widget stays reactive), and wires
 * the native listeners that forward the widget's `zitadel-*` events, which Qwik's
 * declarative `useOn` does not catch.
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
      const onStep = (event: Event): void => void props.onFlowStep$?.(eventDetail(event));
      const onInput = (event: Event): void => void props.onFlowInput$?.(eventDetail(event));
      const onComplete = (event: Event): void => void props.onFlowComplete$?.(eventDetail(event));
      const onRedirect = (event: Event): void => void props.onFlowRedirect$?.(eventDetail(event));
      const onError = (event: Event): void => void props.onFlowError$?.(eventDetail(event));
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
      {...{ [WRAPPER_MARKER]: "" }}
      ref={(el) => {
        host.value = el;
        if (props.ref) {
          props.ref.value = el;
        }
        bindLoginConfig(el, props);
      }}
      {...attributes}
      {...loginAttrs(props)}
    />
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
  ZitadelWidgetAttributes &
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
 * forwards the widget's `zitadel-signout` event as an optional callback.
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
      const onSignout = (event: Event): void => void props.onSignout$?.(eventDetail(event));
      cleanup(listenWithReplay(el, { "zitadel-signout": onSignout }));
    },
    { strategy: "document-ready" },
  );
  return (
    <zitadel-logout
      {...{ [WRAPPER_MARKER]: "" }}
      ref={(el) => {
        host.value = el;
        if (props.ref) {
          props.ref.value = el;
        }
        bindLogoutConfig(el, props);
      }}
      {...attributes}
      {...logoutAttrs(props)}
    />
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
  ZitadelWidgetAttributes &
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
 * `zitadel-signout` event as an optional callback.
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
      const onSignout = (event: Event): void => void props.onSignout$?.(eventDetail(event));
      cleanup(listenWithReplay(el, { "zitadel-signout": onSignout }));
    },
    { strategy: "document-ready" },
  );
  return (
    <zitadel-session
      {...{ [WRAPPER_MARKER]: "" }}
      ref={(el) => {
        host.value = el;
        if (props.ref) {
          props.ref.value = el;
        }
        bindSessionConfig(el, props);
      }}
      {...attributes}
      {...sessionAttrs(props)}
    />
  );
});
