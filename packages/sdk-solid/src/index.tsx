import type { JSX } from 'solid-js';

import '@zitadel/components';
import {
  configureZitadel,
  getApi,
  getZitadelConfig,
  type ZitadelConfig,
  type ZitadelProject,
} from '@zitadel/api/config';

import type {
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowStepDetail,
  ZitadelSignoutDetail,
} from './types';

declare module 'solid-js' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'zitadel-login': HTMLAttributes<HTMLElement> & {
        'prop:project'?: ZitadelProject;
        purpose?: string;
        'post-sign-in-url'?: string;
        'on:zitadel-flow-step'?: (
          event: CustomEvent<ZitadelFlowStepDetail>,
        ) => void;
        'on:zitadel-flow-input'?: (
          event: CustomEvent<ZitadelFlowInputDetail>,
        ) => void;
        'on:zitadel-flow-complete'?: (
          event: CustomEvent<ZitadelFlowCompleteDetail>,
        ) => void;
        'on:zitadel-flow-error'?: (
          event: CustomEvent<ZitadelFlowErrorDetail>,
        ) => void;
      };
      'zitadel-logout': HTMLAttributes<HTMLElement> & {
        'prop:project'?: ZitadelProject;
        'post-sign-out-url'?: string;
        'on:zitadel-signout'?: (
          event: CustomEvent<ZitadelSignoutDetail>,
        ) => void;
      };
    }
  }
}

export { configureZitadel, getApi, getZitadelConfig };
export type { ZitadelConfig, ZitadelProject };
export * from './types';

/** Props for {@link ZitadelLogin}. */
export interface ZitadelLoginProps {
  readonly project: ZitadelProject;
  readonly purpose?: string;
  readonly postSignInUrl?: string;
  readonly onFlowStep?: (detail: ZitadelFlowStepDetail) => void;
  readonly onFlowInput?: (detail: ZitadelFlowInputDetail) => void;
  readonly onFlowComplete?: (detail: ZitadelFlowCompleteDetail) => void;
  readonly onFlowError?: (detail: ZitadelFlowErrorDetail) => void;
}

/**
 * Solid component wrapping the `<zitadel-login>` web component. Binds the
 * {@link ZitadelProject} handle as a DOM property and forwards the widget's
 * `zitadel-*` events as optional callbacks.
 */
export function ZitadelLogin(props: ZitadelLoginProps): JSX.Element {
  return (
    <zitadel-login
      prop:project={props.project}
      purpose={props.purpose ?? 'login'}
      post-sign-in-url={props.postSignInUrl}
      on:zitadel-flow-step={(event) => props.onFlowStep?.(event.detail)}
      on:zitadel-flow-input={(event) => props.onFlowInput?.(event.detail)}
      on:zitadel-flow-complete={(event) => props.onFlowComplete?.(event.detail)}
      on:zitadel-flow-error={(event) => props.onFlowError?.(event.detail)}
    />
  );
}

/** Props for {@link ZitadelLogout}. */
export interface ZitadelLogoutProps {
  readonly project: ZitadelProject;
  readonly postSignOutUrl?: string;
  readonly onSignout?: (detail: ZitadelSignoutDetail) => void;
}

/**
 * Solid component wrapping the `<zitadel-logout>` web component. Binds the
 * {@link ZitadelProject} handle as a DOM property and forwards the widget's
 * `zitadel-signout` event as an optional callback.
 */
export function ZitadelLogout(props: ZitadelLogoutProps): JSX.Element {
  return (
    <zitadel-logout
      prop:project={props.project}
      post-sign-out-url={props.postSignOutUrl}
      on:zitadel-signout={(event) => props.onSignout?.(event.detail)}
    />
  );
}
