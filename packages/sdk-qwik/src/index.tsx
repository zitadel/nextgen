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

/**
 * Passes `project` as a spread because `@zitadel/components`' Qwik JSX types omit
 * the property-only member. Qwik binds objects to custom elements as DOM
 * properties, so the handle reaches the element intact.
 */
function projectProp(project: ZitadelProject): Record<string, unknown> {
  return { project };
}

function eventDetail<T>(event: Event): T {
  return (event as CustomEvent<T>).detail;
}

/** Props for {@link ZitadelLogin}. */
export interface ZitadelLoginProps {
  readonly project: ZitadelProject;
  readonly purpose?: CreateFlowBodyPurpose;
  readonly postSignInUrl?: string;
  readonly onFlowStep$?: QRL<(detail: ZitadelFlowStepDetail) => void>;
  readonly onFlowInput$?: QRL<(detail: ZitadelFlowInputDetail) => void>;
  readonly onFlowComplete$?: QRL<(detail: ZitadelFlowCompleteDetail) => void>;
  readonly onFlowError$?: QRL<(detail: ZitadelFlowErrorDetail) => void>;
}

/**
 * Qwik component wrapping the `<zitadel-login>` web component. Binds the
 * {@link ZitadelProject} handle as a DOM property and forwards the widget's
 * `zitadel-*` events as optional callbacks. `useVisibleTask$` wires the native
 * listeners; Qwik's declarative `useOn` does not catch these programmatic
 * custom events.
 */
export const ZitadelLogin = component$<ZitadelLoginProps>((props) => {
  const host = useSignal<HTMLElement>();
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const el = track(() => host.value);
    if (!el) {
      return;
    }
    const onStep = (event: Event): void =>
      void props.onFlowStep$?.(eventDetail(event));
    const onInput = (event: Event): void =>
      void props.onFlowInput$?.(eventDetail(event));
    const onComplete = (event: Event): void =>
      void props.onFlowComplete$?.(eventDetail(event));
    const onError = (event: Event): void =>
      void props.onFlowError$?.(eventDetail(event));
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

/** Props for {@link ZitadelLogout}. */
export interface ZitadelLogoutProps {
  readonly project: ZitadelProject;
  readonly postSignOutUrl?: string;
  readonly onSignout$?: QRL<(detail: ZitadelSignoutDetail) => void>;
}

/**
 * Qwik component wrapping the `<zitadel-logout>` web component. Binds the
 * {@link ZitadelProject} handle as a DOM property and forwards the widget's
 * `zitadel-signout` event as an optional callback.
 */
export const ZitadelLogout = component$<ZitadelLogoutProps>((props) => {
  const host = useSignal<HTMLElement>();
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const el = track(() => host.value);
    if (!el) {
      return;
    }
    const onSignout = (event: Event): void =>
      void props.onSignout$?.(eventDetail(event));
    el.addEventListener('zitadel-signout', onSignout);
    cleanup(() => {
      el.removeEventListener('zitadel-signout', onSignout);
    });
  });
  return (
    <zitadel-logout
      ref={host}
      {...projectProp(props.project)}
      post-sign-out-url={props.postSignOutUrl}
    />
  );
});
