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
import { component$, useSignal, useVisibleTask$, type QRL, type Signal } from "@qwik.dev/core";
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
 * Assigns a widget config value as a DOM *property*, skipping `undefined` so the
 * element keeps its own accessor default (e.g. the session card's "Signed in
 * as" heading).
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
  if (value !== undefined) {
    el[key] = value;
  }
}

/** Applies the `<zitadel-login>` surface config to the element as DOM properties. */
function bindLoginConfig(el: ZitadelLoginElement, props: ZitadelLoginProps): void {
  setProp(el, "project", props.project);
  setProp(el, "projectId", props.projectId);
  setProp(el, "proxyPath", props.proxyPath);
  setProp(el, "purpose", props.purpose ?? "login");
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
 * element (see {@link setProp}). The `ref` callback applies them synchronously at
 * mount, before the widget's first render; the `useVisibleTask$` tracks the props
 * and re-applies them when any changes (so the widget stays reactive), and wires
 * the native listeners that forward the widget's `zitadel-*` events, which Qwik's
 * declarative `useOn` does not catch.
 */
export const ZitadelLogin = component$<ZitadelLoginProps>((props) => {
  const host = useSignal<ZitadelLoginElement>();
  // eslint-disable-next-line qwik/no-use-visible-task
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
      const onError = (event: Event): void => void props.onFlowError$?.(eventDetail(event));
      el.addEventListener("zitadel-flow-step", onStep);
      el.addEventListener("zitadel-flow-input", onInput);
      el.addEventListener("zitadel-flow-complete", onComplete);
      el.addEventListener("zitadel-flow-error", onError);
      cleanup(() => {
        el.removeEventListener("zitadel-flow-step", onStep);
        el.removeEventListener("zitadel-flow-input", onInput);
        el.removeEventListener("zitadel-flow-complete", onComplete);
        el.removeEventListener("zitadel-flow-error", onError);
      });
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
      }}
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
  const host = useSignal<ZitadelLogoutElement>();
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ track, cleanup }) => {
      const el = track(() => host.value);
      if (!el) {
        return;
      }
      track(() => ({ ...props }));
      bindLogoutConfig(el, props);
      const onSignout = (event: Event): void => void props.onSignout$?.(eventDetail(event));
      el.addEventListener("zitadel-signout", onSignout);
      cleanup(() => {
        el.removeEventListener("zitadel-signout", onSignout);
      });
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
      }}
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
  const host = useSignal<ZitadelSessionElement>();
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ track, cleanup }) => {
      const el = track(() => host.value);
      if (!el) {
        return;
      }
      track(() => ({ ...props }));
      bindSessionConfig(el, props);
      const onSignout = (event: Event): void => void props.onSignout$?.(eventDetail(event));
      el.addEventListener("zitadel-signout", onSignout);
      cleanup(() => {
        el.removeEventListener("zitadel-signout", onSignout);
      });
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
      }}
    />
  );
});
