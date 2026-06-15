import type { CreateFlow201Step } from '@zitadel/api/generated/model';

/** `detail` payloads for the widgets' public `zitadel-*` events. */
export interface ZitadelFlowStepDetail {
  step: CreateFlow201Step;
}
export interface ZitadelFlowInputDetail {
  name: string;
  value: string;
}
export interface ZitadelFlowCompleteDetail {
  behavior: unknown;
  redirect_uri?: string;
  handoff_token?: string;
  handoff_token_expires_at?: string;
}
export interface ZitadelFlowErrorDetail {
  message: string;
}
export interface ZitadelSignoutDetail {
  name: string;
  email: string;
}

/**
 * Re-exports shared SDK types from `@zitadel/sdk-core`.
 */
export type {
  NextgenSession,
  AuthState,
  UnauthState,
  AuthResult,
  NextgenMiddlewareOptions,
} from '@zitadel/sdk-core/types';
