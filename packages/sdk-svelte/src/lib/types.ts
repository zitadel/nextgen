import type { ZitadelProject } from '@zitadel/api/config';
import type {
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowStepDetail,
  ZitadelSignoutDetail,
} from '@zitadel/sdk-core/types';

/**
 * Props for the `ZitadelLogin` component. Supply the SDK handle via `project`,
 * or the discrete `projectId` / `proxyPath` the widget reads as properties — the
 * widget uses whichever is present.
 */
export interface ZitadelLoginProps {
  readonly project?: ZitadelProject;
  readonly projectId?: string;
  readonly proxyPath?: string;
  readonly purpose?: string;
  readonly postSignInUrl?: string;
  readonly onFlowStep?: (detail: ZitadelFlowStepDetail) => void;
  readonly onFlowInput?: (detail: ZitadelFlowInputDetail) => void;
  readonly onFlowComplete?: (detail: ZitadelFlowCompleteDetail) => void;
  readonly onFlowError?: (detail: ZitadelFlowErrorDetail) => void;
}

/**
 * Props for the `ZitadelLogout` component. Supply the SDK handle via `project`,
 * or the discrete `projectId` / `proxyPath` the widget reads as properties — the
 * widget uses whichever is present.
 */
export interface ZitadelLogoutProps {
  readonly project?: ZitadelProject;
  readonly projectId?: string;
  readonly proxyPath?: string;
  readonly postSignOutUrl?: string;
  readonly onSignout?: (detail: ZitadelSignoutDetail) => void;
}

export type {
  ZitadelFlowStepDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelSignoutDetail,
  NextgenSession,
  AuthState,
  UnauthState,
  AuthResult,
  NextgenMiddlewareOptions,
} from '@zitadel/sdk-core/types';
