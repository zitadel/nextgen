import type { ZitadelProject } from "@zitadel/api/config";
import type {
  CreateFlow201Step,
  CreateFlow201StepComplete,
  CreateFlowBodyPurpose,
} from "@zitadel/api/generated/model";

/** Re-exported so consumers can type the `purpose` prop without a deep import. */
export type { CreateFlowBodyPurpose } from "@zitadel/api/generated/model";

/**
 * The SPA widget contract shared by every SPA SDK (`sdk-react`, `sdk-vue`,
 * `sdk-angular`, `sdk-solid`, `sdk-svelte`, `sdk-qwik`): the widget event detail
 * types plus the config/handler/props types derived from them. Each SPA SDK
 * re-exports these from its own public surface so consumers don't need a direct
 * `sdk-core` dependency. The middleware-layer types (`sdk-next`, `sdk-nuxt`) now
 * live in `@zitadel/sdk-core/middleware`.
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
  "zitadel-flow-step": ZitadelFlowStepDetail;
  "zitadel-flow-input": ZitadelFlowInputDetail;
  "zitadel-flow-complete": ZitadelFlowCompleteDetail;
  "zitadel-flow-error": ZitadelFlowErrorDetail;
}

/** Events emitted by `<zitadel-logout>`, keyed to their detail payload. */
export interface ZitadelLogoutEventMap {
  "zitadel-signout": ZitadelSignoutDetail;
}

/**
 * Events emitted by `<zitadel-session>`, keyed to their detail payload.
 * `zitadel-signout` reuses {@link ZitadelSignoutDetail} so the post-sign-in
 * card and the avatar menu speak the same sign-out contract.
 */
export interface ZitadelSessionEventMap {
  "zitadel-signout": ZitadelSignoutDetail;
}

/**
 * Maps each `<zitadel-login>` event to the callback prop the SDKs expose. The
 * `satisfies Record<keyof ZitadelLoginEventMap, …>` is the drift lock: every
 * event needs exactly one handler entry — a missing one, or an extra one left
 * behind for a removed event, fails `tsc`. Everything below derives from this.
 */
export const ZITADEL_LOGIN_EVENT_HANDLERS = {
  "zitadel-flow-step": "onFlowStep",
  "zitadel-flow-input": "onFlowInput",
  "zitadel-flow-complete": "onFlowComplete",
  "zitadel-flow-error": "onFlowError",
} as const satisfies Record<keyof ZitadelLoginEventMap, `on${string}`>;

/** Maps the `<zitadel-logout>` event to the callback prop the SDKs expose. */
export const ZITADEL_LOGOUT_EVENT_HANDLERS = {
  "zitadel-signout": "onSignout",
} as const satisfies Record<keyof ZitadelLogoutEventMap, `on${string}`>;

/** Maps the `<zitadel-session>` event to the callback prop the SDKs expose. */
export const ZITADEL_SESSION_EVENT_HANDLERS = {
  "zitadel-signout": "onSignout",
} as const satisfies Record<keyof ZitadelSessionEventMap, `on${string}`>;

/** Runtime list of `<zitadel-login>` event names (drives wiring + drift tests). */
export const ZITADEL_LOGIN_EVENTS = Object.keys(
  ZITADEL_LOGIN_EVENT_HANDLERS,
) as (keyof ZitadelLoginEventMap)[];

/** Runtime list of `<zitadel-logout>` event names. */
export const ZITADEL_LOGOUT_EVENTS = Object.keys(
  ZITADEL_LOGOUT_EVENT_HANDLERS,
) as (keyof ZitadelLogoutEventMap)[];

/** Runtime list of `<zitadel-session>` event names. */
export const ZITADEL_SESSION_EVENTS = Object.keys(
  ZITADEL_SESSION_EVENT_HANDLERS,
) as (keyof ZitadelSessionEventMap)[];

/** Configuration props shared by every `ZitadelLogin` wrapper. */
export interface ZitadelLoginConfig {
  /** The SDK handle from `configureZitadel(...)`. */
  readonly project?: ZitadelProject;
  /** Discrete project id, read when no {@link project} handle is supplied. */
  readonly projectId?: string;
  /** Reverse-proxy path prefix the widget calls. */
  readonly proxyPath?: string;
  /**
   * Sizing/chrome mode. `widget` (default) is content-sized and paints no
   * page chrome — for embedding inside an existing layout. `page` claims
   * the viewport, paints the surface background, loads the brand font, and
   * focuses the first field — for dedicated login routes.
   * @default "widget"
   */
  readonly variant?: "widget" | "page";
  /**
   * Colour mode. Unset defers to the tenant's `branding.theme.mode`, then to
   * the variant default — `dark` for `page`, `auto` (follow
   * `prefers-color-scheme`) for `widget`. Set it when your app's surface is
   * fixed so the widget doesn't render a dark card on a light page.
   */
  readonly theme?: "light" | "dark" | "auto";
  /**
   * Visually hide the widget's own heading block while keeping it in the
   * accessibility tree — for embeds whose page already carries the heading
   * (a brand-voice title above the card) so the card doesn't repeat it.
   * @default false
   */
  readonly suppressHeader?: boolean;
  /** Flow purpose. @default "login" */
  readonly purpose?: CreateFlowBodyPurpose;
  /**
   * Selects a specific flow definition by its `name` (the `name` field in
   * the flow file). Omit to run the project's default flow for the purpose.
   */
  readonly flowName?: string;
  /** Where to navigate after a completed sign-in. */
  readonly postSignInUrl?: string;
  /**
   * Copy overrides merged over the builtin locale dictionaries, keyed by
   * primary language subtag. Each dictionary may be partial — the widget
   * merges it over the builtin copy — so presets like the components'
   * `businessLocales` overlay are directly assignable. This is how custom
   * flow steps and actions get labels (keys follow `<step>.title`,
   * `<step>.action.<name>`, `<step>.field.<field>`):
   *
   * ```tsx
   * <ZitadelLogin locales={{ en: { "identifier.title": "Welcome back" } }} />
   * ```
   */
  readonly locales?: Record<string, Partial<Record<string, string>>>;
  /** BCP-47 language override; defaults to the browser language. */
  readonly lang?: string;
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
  /**
   * Colour mode. Unset defaults to `auto` (follow `prefers-color-scheme`) —
   * the control lives inside the app's own chrome. Set it when the
   * surrounding surface is fixed.
   */
  readonly theme?: "light" | "dark" | "auto";
}

/** Configuration props shared by every `ZitadelSession` wrapper. */
export interface ZitadelSessionConfig {
  /** The SDK handle from `configureZitadel(...)`. */
  readonly project?: ZitadelProject;
  /** Discrete project id, read when no {@link project} handle is supplied. */
  readonly projectId?: string;
  /** Reverse-proxy path prefix the widget calls. */
  readonly proxyPath?: string;
  /** Where to navigate after sign-out. */
  readonly postSignOutUrl?: string;
  /** Heading text override. */
  readonly heading?: string;
  /** Logout action label override. */
  readonly logoutLabel?: string;
  /**
   * Sizing/chrome mode. `widget` (default) is content-sized and paints no
   * page chrome — for embedding the signed-in card inside an existing
   * layout. `page` claims the viewport and paints the surface background —
   * for dedicated signed-in routes.
   * @default "widget"
   */
  readonly variant?: "widget" | "page";
  /**
   * Colour mode. Unset defers to the variant default — `dark` for `page`,
   * `auto` (follow `prefers-color-scheme`) for `widget`. Set it when your
   * app's surface is fixed so the card doesn't render dark on a light page.
   */
  readonly theme?: "light" | "dark" | "auto";
  /**
   * Visually hide the widget's own heading block while keeping it in the
   * accessibility tree — for embeds whose page already carries the heading
   * (a brand-voice title above the card) so the card doesn't repeat it.
   * @default false
   */
  readonly suppressHeader?: boolean;
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

/** Plain-callback handlers for the `<zitadel-session>` events (derived, as above). */
export type ZitadelSessionHandlers = {
  readonly [E in keyof ZitadelSessionEventMap as (typeof ZITADEL_SESSION_EVENT_HANDLERS)[E]]?: (
    detail: ZitadelSessionEventMap[E],
  ) => void;
};

/** Full prop set for a `ZitadelLogin` wrapper (config + plain-callback handlers). */
export type ZitadelLoginProps = ZitadelLoginConfig & ZitadelLoginHandlers;

/** Full prop set for a `ZitadelLogout` wrapper (config + plain-callback handlers). */
export type ZitadelLogoutProps = ZitadelLogoutConfig & ZitadelLogoutHandlers;

/** Full prop set for a `ZitadelSession` wrapper (config + plain-callback handlers). */
export type ZitadelSessionProps = ZitadelSessionConfig & ZitadelSessionHandlers;
