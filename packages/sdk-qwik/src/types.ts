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

export type {
  NextgenSession,
  AuthState,
  UnauthState,
  AuthResult,
  NextgenMiddlewareOptions,
} from '@zitadel/sdk-core/types';
