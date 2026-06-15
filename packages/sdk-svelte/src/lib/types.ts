import type { ZitadelProject } from '@zitadel/api/config';
import type { CreateFlow201Step } from '@zitadel/api/generated/model';

/** Payload of the `zitadel-flow-step` event. */
export interface ZitadelFlowStepDetail {
  readonly step: CreateFlow201Step;
}

/** Payload of the `zitadel-flow-input` event. */
export interface ZitadelFlowInputDetail {
  readonly name: string;
  readonly value: string;
}

/** Payload of the `zitadel-flow-complete` event. */
export interface ZitadelFlowCompleteDetail {
  readonly behavior: unknown;
  readonly redirect_uri?: string;
  readonly handoff_token?: string;
  readonly handoff_token_expires_at?: string;
}

/** Payload of the `zitadel-flow-error` event. */
export interface ZitadelFlowErrorDetail {
  readonly message: string;
}

/** Payload of the `zitadel-signout` event. */
export interface ZitadelSignoutDetail {
  readonly name: string;
  readonly email: string;
}

/** Props for the `ZitadelLogin` component. */
export interface ZitadelLoginProps {
  readonly project: ZitadelProject;
  readonly purpose?: string;
  readonly postSignInUrl?: string;
  readonly onFlowStep?: (detail: ZitadelFlowStepDetail) => void;
  readonly onFlowInput?: (detail: ZitadelFlowInputDetail) => void;
  readonly onFlowComplete?: (detail: ZitadelFlowCompleteDetail) => void;
  readonly onFlowError?: (detail: ZitadelFlowErrorDetail) => void;
}

/** Props for the `ZitadelLogout` component. */
export interface ZitadelLogoutProps {
  readonly project: ZitadelProject;
  readonly postSignOutUrl?: string;
  readonly onSignout?: (detail: ZitadelSignoutDetail) => void;
}

export type {
  NextgenSession,
  AuthState,
  UnauthState,
  AuthResult,
  NextgenMiddlewareOptions,
} from '@zitadel/sdk-core/types';
