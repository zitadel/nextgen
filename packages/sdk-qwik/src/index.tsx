import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
} from "@zitadel/components";
import type {
  ZitadelLoginConfig,
  ZitadelLoginHandlers,
  ZitadelLogoutConfig,
  ZitadelLogoutHandlers,
} from "@zitadel/sdk-core/types";

import "@zitadel/components";
import { component$, useSignal, useVisibleTask$, type QRL, type Signal } from "@builder.io/qwik";
import { isBrowser } from "@builder.io/qwik/build";
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

/**
 * Derives the widget's declarative `project-id` / `proxy-path` / `url`
 * *attributes* from the SDK handle (or the discrete props), spread because
 * `@zitadel/components`' Qwik JSX types omit these members.
 *
 * Attributes — not the `project` object property — are what make the widget
 * survive Qwik's resumability. Qwik serialises attributes into the SSR'd HTML,
 * so they are present the instant the custom element upgrades on the client and
 * Lit reflects each one onto its `projectId` / `proxyPath` / `url` property. An
 * object bound only as the `project` property, by contrast, is dropped on
 * resume — Qwik does not re-apply object DOM properties to a plain custom
 * element after hydration — which left the element unconfigured and the flow
 * erroring with "requires a configured project". A `ZitadelProject` is just
 * `{ projectId, proxyPath, url? }`, so the three attributes express it fully.
 *
 * The SDK handle is *additionally* bound as the `project` property (see the
 * `ref` below); when present it wins by `resolveApi()` precedence, so the
 * in-memory handle (and its shared API-client cache) is still used once the ref
 * runs. The attributes are the resume-safe fallback that closes the timing gap.
 * Undefined values are omitted so the widget keeps its own `proxy-path` default.
 */
function projectAttrs(
  project: ZitadelProject | undefined,
  projectId: string | undefined,
  proxyPath: string | undefined,
): Record<string, string | undefined> {
  return {
    "project-id": project?.projectId ?? projectId,
    "proxy-path": project?.proxyPath ?? proxyPath,
    url: project?.url,
  };
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
        // Bind the SDK handle as the `project` property too: when the ref runs
        // before the deferred `startFlow()`, the in-memory handle wins by
        // precedence; the `project-id` attribute below is the resume-safe path.
        // Guard to the browser — Qwik also runs `ref` during SSR, where `el` is
        // a non-extensible virtual node and assigning to it throws.
        if (isBrowser && props.project) {
          el.project = props.project;
        }
        if (props.ref) {
          props.ref.value = el;
        }
      }}
      {...projectAttrs(props.project, props.projectId, props.proxyPath)}
      purpose={props.purpose ?? "login"}
      post-sign-in-url={props.postSignInUrl}
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
        // See ZitadelLogin: bind the handle as `project` for precedence, while
        // the `project-id` attribute below survives Qwik's resume. Browser-only
        // — `ref` also runs during SSR, where `el` is non-extensible.
        if (isBrowser && props.project) {
          el.project = props.project;
        }
        if (props.ref) {
          props.ref.value = el;
        }
      }}
      {...projectAttrs(props.project, props.projectId, props.proxyPath)}
      post-sign-out-url={props.postSignOutUrl}
    />
  );
});
