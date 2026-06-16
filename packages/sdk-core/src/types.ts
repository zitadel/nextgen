import type { ZitadelProject } from '@zitadel/api/config';
import type {
  CreateFlow201Step,
  CreateFlow201StepComplete,
  CreateFlowBodyPurpose,
} from '@zitadel/api/generated/model';

/** Re-exported so consumers can type the `purpose` prop without a deep import. */
export type { CreateFlowBodyPurpose } from '@zitadel/api/generated/model';

/**
 * Shared types for the Nextgen SDKs: the middleware layer (`sdk-next`,
 * `sdk-nuxt`) and the SPA widget events (`sdk-react`, `sdk-vue`, `sdk-solid`,
 * `sdk-svelte`, `sdk-qwik`). Each SDK re-exports them from its own public
 * surface so consumers don't need a direct `sdk-core` dependency.
 */

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
  readonly behavior: CreateFlow201StepComplete;
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

/* ───────────────────────────  SPA widget contract  ───────────────────────
 * Single source of truth shared by every SPA SDK (react, vue, angular, solid,
 * svelte, qwik). The event maps below declare which widget events exist and
 * what each carries; the config/handler/props types and the runtime name lists
 * are all derived from them. Adding or removing an event here is the ONE edit
 * that ripples to every SDK — the compile-time assertions in this file, the
 * `@zitadel/components` emit-conformance test, and each SDK's contract-driven
 * forwarding test all fail until every wrapper is brought back into line.
 * ───────────────────────────────────────────────────────────────────────── */

/** Events emitted by `<zitadel-login>`, keyed to their detail payload. */
export interface ZitadelLoginEventMap {
  'zitadel-flow-step': ZitadelFlowStepDetail;
  'zitadel-flow-input': ZitadelFlowInputDetail;
  'zitadel-flow-complete': ZitadelFlowCompleteDetail;
  'zitadel-flow-error': ZitadelFlowErrorDetail;
}

/** Events emitted by `<zitadel-logout>`, keyed to their detail payload. */
export interface ZitadelLogoutEventMap {
  'zitadel-signout': ZitadelSignoutDetail;
}

/**
 * Maps each `<zitadel-login>` event to the callback prop the SDKs expose. The
 * `satisfies Record<keyof ZitadelLoginEventMap, …>` is the drift lock: every
 * event needs exactly one handler entry — a missing one, or an extra one left
 * behind for a removed event, fails `tsc`. Everything below derives from this.
 */
export const ZITADEL_LOGIN_EVENT_HANDLERS = {
  'zitadel-flow-step': 'onFlowStep',
  'zitadel-flow-input': 'onFlowInput',
  'zitadel-flow-complete': 'onFlowComplete',
  'zitadel-flow-error': 'onFlowError',
} as const satisfies Record<keyof ZitadelLoginEventMap, `on${string}`>;

/** Maps the `<zitadel-logout>` event to the callback prop the SDKs expose. */
export const ZITADEL_LOGOUT_EVENT_HANDLERS = {
  'zitadel-signout': 'onSignout',
} as const satisfies Record<keyof ZitadelLogoutEventMap, `on${string}`>;

/** Runtime list of `<zitadel-login>` event names (drives wiring + drift tests). */
export const ZITADEL_LOGIN_EVENTS = Object.keys(
  ZITADEL_LOGIN_EVENT_HANDLERS,
) as (keyof ZitadelLoginEventMap)[];

/** Runtime list of `<zitadel-logout>` event names. */
export const ZITADEL_LOGOUT_EVENTS = Object.keys(
  ZITADEL_LOGOUT_EVENT_HANDLERS,
) as (keyof ZitadelLogoutEventMap)[];

/** Configuration props shared by every `ZitadelLogin` wrapper. */
export interface ZitadelLoginConfig {
  /** The SDK handle from `configureZitadel(...)`. */
  readonly project?: ZitadelProject;
  /** Discrete project id, read when no {@link project} handle is supplied. */
  readonly projectId?: string;
  /** Reverse-proxy path prefix the widget calls. */
  readonly proxyPath?: string;
  /** Flow purpose. @default "login" */
  readonly purpose?: CreateFlowBodyPurpose;
  /** Where to navigate after a completed sign-in. */
  readonly postSignInUrl?: string;
}

/** Configuration props shared by every `ZitadelLogout` wrapper. */
export interface ZitadelLogoutConfig {
  /** The SDK handle from `configureZitadel(...)`. */
  readonly project?: ZitadelProject;
  /** Discrete project id, read when no {@link project} handle is supplied. */
  readonly projectId?: string;
  /** Reverse-proxy path prefix the widget calls. */
  readonly proxyPath?: string;
  /** Where to navigate after sign-out. */
  readonly postSignOutUrl?: string;
}

/**
 * Plain-callback handlers for the `<zitadel-login>` events, derived from
 * {@link ZitadelLoginEventMap} and {@link ZITADEL_LOGIN_EVENT_HANDLERS} so the
 * prop set can never drift from the events it forwards.
 */
export type ZitadelLoginHandlers = {
  readonly [E in keyof ZitadelLoginEventMap as (typeof ZITADEL_LOGIN_EVENT_HANDLERS)[E]]?: (
    detail: ZitadelLoginEventMap[E],
  ) => void;
};

/** Plain-callback handler for the `<zitadel-logout>` event (derived, as above). */
export type ZitadelLogoutHandlers = {
  readonly [E in keyof ZitadelLogoutEventMap as (typeof ZITADEL_LOGOUT_EVENT_HANDLERS)[E]]?: (
    detail: ZitadelLogoutEventMap[E],
  ) => void;
};

/** Full prop set for a `ZitadelLogin` wrapper (config + plain-callback handlers). */
export type ZitadelLoginProps = ZitadelLoginConfig & ZitadelLoginHandlers;

/** Full prop set for a `ZitadelLogout` wrapper (config + plain-callback handlers). */
export type ZitadelLogoutProps = ZitadelLogoutConfig & ZitadelLogoutHandlers;
