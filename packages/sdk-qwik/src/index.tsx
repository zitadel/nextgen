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
import { component$, useSignal, useVisibleTask$, type QRL, type Signal } from "@builder.io/qwik";
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
 * Passes the project config as a spread because `@zitadel/components`' Qwik JSX
 * types omit these property-only members. Qwik binds object and string values to
 * custom elements as DOM properties, so the handle (or the discrete project id /
 * proxy path) reaches the element intact. The widget uses whichever is present.
 */
function projectProp(
  project: ZitadelProject | undefined,
  projectId: string | undefined,
  proxyPath: string | undefined,
): Record<string, unknown> {
  return { project, projectId, proxyPath };
}

/**
 * Login-only copy overrides, spread for the same reason as {@link projectProp}:
 * `locales`/`lang` are property-only members the custom-element JSX types omit.
 */
function localeProps(
  locales: Record<string, Partial<Record<string, string>>> | undefined,
  lang: string | undefined,
): Record<string, unknown> {
  return { locales, lang };
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
 * {@link ZitadelProject} handle as a DOM property (or the discrete project id /
 * proxy path) and forwards the widget's `zitadel-*` events as optional
 * callbacks. `useVisibleTask$` (eager `document-ready`, so listeners attach on
 * load rather than on first visibility) wires the native listeners; Qwik's
 * declarative `useOn` does not catch these programmatic custom events.
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
      }}
      {...projectProp(props.project, props.projectId, props.proxyPath)}
      {...localeProps(props.locales, props.lang)}
      purpose={props.purpose ?? "login"}
      flow-name={props.flowName}
      post-sign-in-url={props.postSignInUrl}
      variant={props.variant}
      theme={props.theme}
      suppressHeader={props.suppressHeader}
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
 * {@link ZitadelProject} handle as a DOM property (or the discrete project id /
 * proxy path) and forwards the widget's `zitadel-signout` event as an optional
 * callback.
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
      }}
      {...projectProp(props.project, props.projectId, props.proxyPath)}
      post-sign-out-url={props.postSignOutUrl}
      theme={props.theme}
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
 * post-sign-in "signed in as" card. Binds the {@link ZitadelProject} handle as
 * a DOM property (or the discrete project id / proxy path) and forwards the
 * widget's `zitadel-signout` event as an optional callback.
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
      }}
      {...projectProp(props.project, props.projectId, props.proxyPath)}
      post-sign-out-url={props.postSignOutUrl}
      heading={props.heading}
      logout-label={props.logoutLabel}
      variant={props.variant}
      theme={props.theme}
      suppressHeader={props.suppressHeader}
    />
  );
});
