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

// Teach Qwik's JSX about the custom elements.
declare module '@builder.io/qwik' {
  interface QwikIntrinsicElements {
    'zitadel-login': QwikIntrinsicElements['div'];
    'zitadel-logout': QwikIntrinsicElements['div'];
  }
}

export { configureZitadel, getApi, getZitadelConfig };
export type { ZitadelConfig, ZitadelProject };
export * from './types';

// Qwik binds lazily, so the SDK `project` handle (a non-serializable object)
// can't ride as a late-bound DOM property — it races the element's startup.
// Instead pass the handle's `projectId`/`proxyPath` as ATTRIBUTES (synchronous,
// present at upgrade), register the (browser-only Lit) components client-only in
// a visible task, and wire `zitadel-flow-*` events imperatively (Qwik's
// declarative `useOn` does not catch these programmatic custom events).

export interface ZitadelLoginProps {
  project: ZitadelProject;
  purpose?: CreateFlowBodyPurpose;
  postSignInUrl?: string;
  onFlowStep$?: QRL<(detail: unknown) => void>;
  onFlowComplete$?: QRL<(detail: unknown) => void>;
  onFlowError$?: QRL<(detail: unknown) => void>;
}

export const ZitadelLogin = component$<ZitadelLoginProps>((props) => {
  const host = useSignal<HTMLElement>();
  // Wiring native listeners on a third-party custom element requires the DOM
  // post-mount; `useOn` does not catch these programmatic events.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const el = track(() => host.value);
    if (!el) return;
    void import('@zitadel/components');
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
      project-id={props.project.projectId}
      proxy-path={props.project.proxyPath}
      purpose={props.purpose ?? 'login'}
      post-sign-in-url={props.postSignInUrl}
    />
  );
});

export interface ZitadelLogoutProps {
  project: ZitadelProject;
  postSignOutUrl?: string;
}

export const ZitadelLogout = component$<ZitadelLogoutProps>((props) => {
  const host = useSignal<HTMLElement>();
  // Client-only registration of the (browser-only Lit) components.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const el = track(() => host.value);
    if (el) void import('@zitadel/components');
  });
  return (
    <zitadel-logout
      ref={host}
      project-id={props.project.projectId}
      proxy-path={props.project.proxyPath}
      post-sign-out-url={props.postSignOutUrl}
    />
  );
});
