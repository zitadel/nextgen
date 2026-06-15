import type { JSX } from 'solid-js';

// Registers <zitadel-login> / <zitadel-logout> with the browser, before render,
// so Solid binds `project` as a DOM property on an upgraded element.
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

// Teach Solid's JSX about the elements, the explicit `project` property, and the
// `zitadel-*` custom events (prop:/on: keys declared directly so the
// declaration build is self-contained).
declare module 'solid-js' {
  // Solid exposes its JSX types through the `JSX` namespace; reopening it is the
  // only way to register custom elements + their prop:/on: keys.
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

export interface ZitadelLoginProps {
  project: ZitadelProject;
  purpose?: string;
  postSignInUrl?: string;
  onFlowStep?: (detail: ZitadelFlowStepDetail) => void;
  onFlowInput?: (detail: ZitadelFlowInputDetail) => void;
  onFlowComplete?: (detail: ZitadelFlowCompleteDetail) => void;
  onFlowError?: (detail: ZitadelFlowErrorDetail) => void;
}

/**
 * Solid wrapper for the `<zitadel-login>` Lit web component. Binds the SDK
 * `project` handle as a DOM property via Solid's `prop:` namespace, and surfaces
 * the widget's `zitadel-*` events as optional callbacks.
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

export interface ZitadelLogoutProps {
  project: ZitadelProject;
  postSignOutUrl?: string;
  onSignout?: (detail: ZitadelSignoutDetail) => void;
}

/** Solid wrapper for the `<zitadel-logout>` Lit web component. */
export function ZitadelLogout(props: ZitadelLogoutProps): JSX.Element {
  return (
    <zitadel-logout
      prop:project={props.project}
      post-sign-out-url={props.postSignOutUrl}
      on:zitadel-signout={(event) => props.onSignout?.(event.detail)}
    />
  );
}
