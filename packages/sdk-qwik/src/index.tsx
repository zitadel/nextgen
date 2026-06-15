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

import type {
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowStepDetail,
  ZitadelSignoutDetail,
} from './types';

export { configureZitadel, getApi, getZitadelConfig };
export type { ZitadelConfig, ZitadelProject };
export * from './types';

// `@zitadel/components` ships Qwik JSX types for the elements but omits the
// property-only `project` member (it has `attribute: false`). Qwik binds objects
// to custom elements as DOM *properties*, so we set it via a spread.
function projectProp(project: ZitadelProject): Record<string, unknown> {
  return { project };
}

function detail<T>(event: Event): T {
  return (event as CustomEvent<T>).detail;
}

export interface ZitadelLoginProps {
  project: ZitadelProject;
  purpose?: CreateFlowBodyPurpose;
  postSignInUrl?: string;
  onFlowStep$?: QRL<(detail: ZitadelFlowStepDetail) => void>;
  onFlowInput$?: QRL<(detail: ZitadelFlowInputDetail) => void>;
  onFlowComplete$?: QRL<(detail: ZitadelFlowCompleteDetail) => void>;
  onFlowError$?: QRL<(detail: ZitadelFlowErrorDetail) => void>;
}

/**
 * Qwik wrapper for the `<zitadel-login>` Lit web component. Binds the SDK
 * `project` handle as a DOM property, and surfaces the widget's `zitadel-*`
 * events as optional callbacks. `useVisibleTask$` is the documented escape hatch
 * for wiring native listeners on a third-party element; Qwik's declarative
 * `useOn` does not catch these programmatic custom events.
 */
export const ZitadelLogin = component$<ZitadelLoginProps>((props) => {
  const host = useSignal<HTMLElement>();
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const el = track(() => host.value);
    if (!el) return;
    const onStep = (e: Event) => void props.onFlowStep$?.(detail(e));
    const onInput = (e: Event) => void props.onFlowInput$?.(detail(e));
    const onComplete = (e: Event) => void props.onFlowComplete$?.(detail(e));
    const onError = (e: Event) => void props.onFlowError$?.(detail(e));
    el.addEventListener('zitadel-flow-step', onStep);
    el.addEventListener('zitadel-flow-input', onInput);
    el.addEventListener('zitadel-flow-complete', onComplete);
    el.addEventListener('zitadel-flow-error', onError);
    cleanup(() => {
      el.removeEventListener('zitadel-flow-step', onStep);
      el.removeEventListener('zitadel-flow-input', onInput);
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
  onSignout$?: QRL<(detail: ZitadelSignoutDetail) => void>;
}

/** Qwik wrapper for the `<zitadel-logout>` Lit web component. */
export const ZitadelLogout = component$<ZitadelLogoutProps>((props) => {
  const host = useSignal<HTMLElement>();
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const el = track(() => host.value);
    if (!el) return;
    const onSignout = (e: Event) => void props.onSignout$?.(detail(e));
    el.addEventListener('zitadel-signout', onSignout);
    cleanup(() => el.removeEventListener('zitadel-signout', onSignout));
  });
  return (
    <zitadel-logout
      ref={host}
      {...projectProp(props.project)}
      post-sign-out-url={props.postSignOutUrl}
    />
  );
});
