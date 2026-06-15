import type { CreateFlowBodyPurpose } from '@zitadel/api/generated/model';

import {
  component$,
  useSignal,
  useVisibleTask$,
  type QRL,
} from '@builder.io/qwik';
import {
  configureZitadel,
  getApi,
  getZitadelConfig,
  type ZitadelConfig,
  type ZitadelProject,
} from '@zitadel/api/config';
// Registers <zitadel-login> / <zitadel-logout> with the browser, before render.
import '@zitadel/components';

export { configureZitadel, getApi, getZitadelConfig };
export type { ZitadelConfig, ZitadelProject };
export * from './types';

// `@zitadel/components` ships Qwik JSX types for the elements but omits the
// property-only `project` member (it has `attribute: false`). Qwik binds objects
// to custom elements as DOM *properties*, so we set it via a spread.
function projectProp(project: ZitadelProject): Record<string, unknown> {
  return { project };
}

export interface ZitadelLoginProps {
  project: ZitadelProject;
  purpose?: CreateFlowBodyPurpose;
  postSignInUrl?: string;
  onFlowStep$?: QRL<(detail: unknown) => void>;
  onFlowComplete$?: QRL<(detail: unknown) => void>;
  onFlowError$?: QRL<(detail: unknown) => void>;
}

/**
 * Qwik wrapper for the `<zitadel-login>` Lit web component. Binds the SDK
 * `project` handle as a DOM property (Qwik passes objects to custom elements as
 * properties), and surfaces the widget's `zitadel-flow-*` events as optional
 * callbacks. `useVisibleTask$` is the documented escape hatch for wiring native
 * listeners on a third-party element; Qwik's declarative `useOn` does not catch
 * these programmatic custom events.
 */
export const ZitadelLogin = component$<ZitadelLoginProps>((props) => {
  const host = useSignal<HTMLElement>();
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const el = track(() => host.value);
    if (!el) return;
    const onStep = (e: Event) =>
      void props.onFlowStep$?.((e as CustomEvent).detail);
    const onComplete = (e: Event) =>
      void props.onFlowComplete$?.((e as CustomEvent).detail);
    const onError = (e: Event) =>
      void props.onFlowError$?.((e as CustomEvent).detail);
    el.addEventListener('zitadel-flow-step', onStep);
    el.addEventListener('zitadel-flow-complete', onComplete);
    el.addEventListener('zitadel-flow-error', onError);
    cleanup(() => {
      el.removeEventListener('zitadel-flow-step', onStep);
      el.removeEventListener('zitadel-flow-complete', onComplete);
      el.removeEventListener('zitadel-flow-error', onError);
    });
  });
  return (
    <zitadel-login
      ref={host}
      {...projectProp(props.project)}
      purpose={props.purpose ?? 'login'}
      post-sign-in-url={props.postSignInUrl}
    />
  );
});

export interface ZitadelLogoutProps {
  project: ZitadelProject;
  postSignOutUrl?: string;
}

/** Qwik wrapper for the `<zitadel-logout>` Lit web component. */
export const ZitadelLogout = component$<ZitadelLogoutProps>((props) => {
  return (
    <zitadel-logout
      {...projectProp(props.project)}
      post-sign-out-url={props.postSignOutUrl}
    />
  );
});
