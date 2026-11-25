import type { ZitadelProject } from "@zitadel/api/config";
import type {
  CreateFlow201Step,
  CreateFlow201StepComplete,
  CreateFlowBodyPurpose,
} from "@zitadel/api/generated/model";

/**
 * Re-exported so consumers can type the `purpose` prop without a deep import
 * into the generated API client: the value set is owned by the OpenAPI
 * contract and this alias follows it, so the prop can never drift from what
 * the server accepts.
 */
export type { CreateFlowBodyPurpose } from "@zitadel/api/generated/model";

/**
 * The SPA widget contract shared by every SPA SDK (`sdk-react`, `sdk-vue`,
 * `sdk-angular`, `sdk-solid`, `sdk-svelte`, `sdk-qwik`): the widget event detail
 * types plus the config/handler/props types derived from them. Each SPA SDK
 * re-exports these from its own public surface so consumers don't need a direct
 * `sdk-core` dependency. The middleware-layer types (`sdk-next`, `sdk-nuxt`) now
 * live in `@zitadel/sdk-core/middleware`.
 */

/**
 * Payload of the `zitadel-flow-step` event, fired each time the server moves
 * the flow to a new step (identifier, password, MFA and so on). Listen to it to
 * mirror progress in the host page or to record analytics.
 */
export interface ZitadelFlowStepDetail {
  /** The step the flow has just entered, exactly as the server returned it. */
  readonly step: CreateFlow201Step;
}

/**
 * Payload of the `zitadel-flow-input` event, fired when the user changes a
 * field in the current step. It lets a host page react to typing (for example
 * to enable its own controls) without owning the form.
 */
export interface ZitadelFlowInputDetail {
  /** The name of the field that changed, as the flow step declares it. */
  readonly name: string;
  /** The field's new value as typed; it is not validated or trimmed. */
  readonly value: string;
}

/**
 * Carried by the events after which the widget navigates. A listener whose work
 * must finish first (an async handler, a lazily loaded callback) passes its
 * promise to `waitUntil`; the widget navigates once every promise has settled,
 * or after a short timeout.
 */
export interface ZitadelNavigationDetail {
  /**
   * Registers work the widget must wait for before it navigates. Call it
   * synchronously from the listener with the promise (or any value) the
   * navigation depends on; it exists so an async handler, such as one that
   * stores a session, is not cut off by the page unloading. The widget
   * navigates after every registered promise settles, or after a short
   * timeout, so a handler that never settles cannot block it.
   */
  readonly waitUntil: (work: unknown) => void;
}

/**
 * Payload of the `zitadel-flow-complete` event, fired when the flow finishes
 * and the user is signed in. The widget navigates afterwards, so register any
 * work that must finish first with {@link ZitadelNavigationDetail.waitUntil}.
 */
export interface ZitadelFlowCompleteDetail extends ZitadelNavigationDetail {
  /** What the server asked the client to do on completion, as returned by the flow. */
  readonly behavior: CreateFlow201StepComplete;
  /** Where the server sends the browser next; absent when the flow names no destination. */
  readonly redirect_uri?: string;
  /**
   * A short-lived token the server issues so a different origin can pick up
   * the signed-in session. Absent unless the flow completed with a handoff.
   */
  readonly handoff_token?: string;
  /** When {@link handoff_token} stops being accepted, as an ISO 8601 timestamp. */
  readonly handoff_token_expires_at?: string;
}

/**
 * Payload of the `zitadel-flow-redirect` event — the widget is handing the
 * browser to an identity provider. Distinct from `zitadel-flow-complete`:
 * nobody is signed in yet, and the flow resumes when the provider returns.
 */
export interface ZitadelFlowRedirectDetail extends ZitadelNavigationDetail {
  /** The identity provider URL the widget is about to send the browser to. */
  readonly redirect_url: string;
  /** The step that triggered the redirect, so a listener can tell which provider was chosen. */
  readonly step: CreateFlow201Step;
}

/**
 * Payload of the `zitadel-flow-error` event, fired when the flow fails in a way
 * the widget cannot recover from by itself, such as a network or server error.
 */
export interface ZitadelFlowErrorDetail {
  /** A human-readable description of what went wrong; not a stable code to branch on. */
  readonly message: string;
}

/**
 * Payload of the `zitadel-signout` event, fired by `<zitadel-logout>` and
 * `<zitadel-session>` once the session has been ended and before the widget
 * navigates away.
 */
export interface ZitadelSignoutDetail extends ZitadelNavigationDetail {
  /** The signed-out user's display rendering ("" when none was resolved). */
  readonly display: string;
  /** The signed-out user's login identifier ("" when none was resolved). */
  readonly identifier: string;
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

/** @internal Events emitted by `<zitadel-login>`, keyed to their detail payload. */
export interface ZitadelLoginEventMap {
  "zitadel-flow-step": ZitadelFlowStepDetail;
  "zitadel-flow-input": ZitadelFlowInputDetail;
  "zitadel-flow-complete": ZitadelFlowCompleteDetail;
  "zitadel-flow-redirect": ZitadelFlowRedirectDetail;
  "zitadel-flow-error": ZitadelFlowErrorDetail;
}

/** @internal Events emitted by `<zitadel-logout>`, keyed to their detail payload. */
export interface ZitadelLogoutEventMap {
  "zitadel-signout": ZitadelSignoutDetail;
}

/**
 * @internal Events emitted by `<zitadel-session>`, keyed to their detail payload.
 * `zitadel-signout` reuses {@link ZitadelSignoutDetail} so the post-sign-in
 * card and the avatar menu speak the same sign-out contract.
 */
export interface ZitadelSessionEventMap {
  "zitadel-signout": ZitadelSignoutDetail;
}

/**
 * @internal Maps each `<zitadel-login>` event to the callback prop the SDKs expose. The
 * `satisfies Record<keyof ZitadelLoginEventMap, …>` is the drift lock: every
 * event needs exactly one handler entry — a missing one, or an extra one left
 * behind for a removed event, fails `tsc`. Everything below derives from this.
 */
export const ZITADEL_LOGIN_EVENT_HANDLERS = {
  "zitadel-flow-step": "onFlowStep",
  "zitadel-flow-input": "onFlowInput",
  "zitadel-flow-complete": "onFlowComplete",
  "zitadel-flow-redirect": "onFlowRedirect",
  "zitadel-flow-error": "onFlowError",
} as const satisfies Record<keyof ZitadelLoginEventMap, `on${string}`>;

/** @internal Maps the `<zitadel-logout>` event to the callback prop the SDKs expose. */
export const ZITADEL_LOGOUT_EVENT_HANDLERS = {
  "zitadel-signout": "onSignout",
} as const satisfies Record<keyof ZitadelLogoutEventMap, `on${string}`>;

/** @internal Maps the `<zitadel-session>` event to the callback prop the SDKs expose. */
export const ZITADEL_SESSION_EVENT_HANDLERS = {
  "zitadel-signout": "onSignout",
} as const satisfies Record<keyof ZitadelSessionEventMap, `on${string}`>;

/** @internal Runtime list of `<zitadel-login>` event names (drives wiring + drift tests). */
export const ZITADEL_LOGIN_EVENTS = Object.keys(
  ZITADEL_LOGIN_EVENT_HANDLERS,
) as (keyof ZitadelLoginEventMap)[];

/** @internal Runtime list of `<zitadel-logout>` event names. */
export const ZITADEL_LOGOUT_EVENTS = Object.keys(
  ZITADEL_LOGOUT_EVENT_HANDLERS,
) as (keyof ZitadelLogoutEventMap)[];

/** @internal Runtime list of `<zitadel-session>` event names. */
export const ZITADEL_SESSION_EVENTS = Object.keys(
  ZITADEL_SESSION_EVENT_HANDLERS,
) as (keyof ZitadelSessionEventMap)[];

/**
 * Configuration props shared by every `ZitadelLogin` wrapper. They are the
 * attributes of the `<zitadel-login>` element in camelCase, so the SDKs
 * forward them one to one instead of each inventing its own names.
 */
export interface ZitadelLoginConfig {
  /**
   * The SDK handle from `configureZitadel(...)`. When set, it supplies the
   * project id and proxy path and the discrete props below are ignored.
   */
  readonly project?: ZitadelProject;
  /**
   * The project the widget signs users in to, for apps that do not use a
   * {@link project} handle. Ignored when {@link project} is set.
   */
  readonly projectId?: string;
  /**
   * Path prefix of the same-origin proxy the widget calls instead of the auth
   * backend directly, so the session cookie is first-party and no CORS setup
   * is needed. The SDK's server middleware serves the proxy.
   * @default "/__nextgen"
   */
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
  /**
   * Hide the show/hide button on password fields. The button is shown by
   * default, as NIST SP 800-63B recommends.
   * @default false
   */
  readonly suppressPasswordToggle?: boolean;
  /** Flow purpose. @default "login" */
  readonly purpose?: CreateFlowBodyPurpose;
  /**
   * Selects a specific flow definition by its `name` (the `name` field in
   * the flow file). Omit to run the project's default flow for the purpose.
   */
  readonly flowName?: string;
  /**
   * Where to navigate after a completed sign-in. When the page's `next` query
   * parameter names a path on the same origin, the widget returns there
   * instead: the server SDKs' middleware sends a signed-out request for a
   * protected route to the login page with `?next=<path>`.
   */
  readonly postSignInUrl?: string;
  /**
   * Go to {@link postSignInUrl} even when the page's `next` query parameter
   * names a path, for a page that uses `next` for something of its own.
   * @default false
   */
  readonly forcePostSignInUrl?: boolean;
  /**
   * An existing flow's id to resume instead of starting a new flow, for
   * example one kept across a reload. Unset or `null` falls back to the `flow` query
   * parameter a provider callback brings back; an id that no longer resolves
   * starts a new flow.
   */
  readonly resumeFlowId?: string | null;
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

/**
 * Configuration props shared by every `ZitadelLogout` wrapper, the
 * attributes of the `<zitadel-logout>` element in camelCase.
 */
export interface ZitadelLogoutConfig {
  /**
   * The SDK handle from `configureZitadel(...)`. When set, it supplies the
   * project id and proxy path and the discrete props below are ignored.
   */
  readonly project?: ZitadelProject;
  /**
   * The project the widget signs users in to, for apps that do not use a
   * {@link project} handle. Ignored when {@link project} is set.
   */
  readonly projectId?: string;
  /**
   * Path prefix of the same-origin proxy the widget calls instead of the auth
   * backend directly, so the session cookie is first-party and no CORS setup
   * is needed. The SDK's server middleware serves the proxy.
   * @default "/__nextgen"
   */
  readonly proxyPath?: string;
  /**
   * Where to navigate after sign-out. Unset leaves the page where it is once
   * the session has ended.
   */
  readonly postSignOutUrl?: string;
  /**
   * Colour mode. Unset defaults to `auto` (follow `prefers-color-scheme`) —
   * the control lives inside the app's own chrome. Set it when the
   * surrounding surface is fixed.
   */
  readonly theme?: "light" | "dark" | "auto";
}

/**
 * Configuration props shared by every `ZitadelSession` wrapper, the
 * attributes of the `<zitadel-session>` element in camelCase.
 */
export interface ZitadelSessionConfig {
  /**
   * The SDK handle from `configureZitadel(...)`. When set, it supplies the
   * project id and proxy path and the discrete props below are ignored.
   */
  readonly project?: ZitadelProject;
  /**
   * The project the widget signs users in to, for apps that do not use a
   * {@link project} handle. Ignored when {@link project} is set.
   */
  readonly projectId?: string;
  /**
   * Path prefix of the same-origin proxy the widget calls instead of the auth
   * backend directly, so the session cookie is first-party and no CORS setup
   * is needed. The SDK's server middleware serves the proxy.
   * @default "/__nextgen"
   */
  readonly proxyPath?: string;
  /**
   * Where to navigate after sign-out. Unset leaves the page where it is once
   * the session has ended.
   */
  readonly postSignOutUrl?: string;
  /** Replaces the card's heading, for copy or a language the builtin locales lack. */
  readonly heading?: string;
  /** Replaces the label of the sign-out action on the card. */
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
 * Callback props for the `<zitadel-login>` events: `onFlowStep`,
 * `onFlowInput`, `onFlowComplete`, `onFlowRedirect` and `onFlowError`, each
 * receiving the matching detail type ({@link ZitadelFlowStepDetail} and its
 * siblings). They are plain callbacks rather than DOM events so every
 * framework wrapper exposes the same props. The set is derived from the
 * widget's event list, so it cannot drift from the events the widget emits.
 * A handler for an event that navigates afterwards may return a promise; the
 * widget does not wait for it, use {@link ZitadelNavigationDetail.waitUntil}.
 */
export type ZitadelLoginHandlers = {
  readonly [E in keyof ZitadelLoginEventMap as (typeof ZITADEL_LOGIN_EVENT_HANDLERS)[E]]?: (
    detail: ZitadelLoginEventMap[E],
  ) => ZitadelLoginEventMap[E] extends ZitadelNavigationDetail ? unknown : void;
};

/**
 * Callback prop for the `<zitadel-logout>` event: `onSignout`, receiving a
 * {@link ZitadelSignoutDetail}. Derived from the widget's event list like
 * {@link ZitadelLoginHandlers}.
 */
export type ZitadelLogoutHandlers = {
  readonly [E in keyof ZitadelLogoutEventMap as (typeof ZITADEL_LOGOUT_EVENT_HANDLERS)[E]]?: (
    detail: ZitadelLogoutEventMap[E],
  ) => ZitadelLogoutEventMap[E] extends ZitadelNavigationDetail ? unknown : void;
};

/**
 * Callback prop for the `<zitadel-session>` event: `onSignout`, receiving a
 * {@link ZitadelSignoutDetail}. Derived from the widget's event list like
 * {@link ZitadelLoginHandlers}.
 */
export type ZitadelSessionHandlers = {
  readonly [E in keyof ZitadelSessionEventMap as (typeof ZITADEL_SESSION_EVENT_HANDLERS)[E]]?: (
    detail: ZitadelSessionEventMap[E],
  ) => ZitadelSessionEventMap[E] extends ZitadelNavigationDetail ? unknown : void;
};

/**
 * The full prop set of a `ZitadelLogin` wrapper: the configuration
 * ({@link ZitadelLoginConfig}) plus the event callbacks
 * ({@link ZitadelLoginHandlers}). Each SDK's wrapper props type builds on it.
 */
export type ZitadelLoginProps = ZitadelLoginConfig & ZitadelLoginHandlers;

/**
 * The full prop set of a `ZitadelLogout` wrapper: {@link ZitadelLogoutConfig}
 * plus {@link ZitadelLogoutHandlers}.
 */
export type ZitadelLogoutProps = ZitadelLogoutConfig & ZitadelLogoutHandlers;

/**
 * The full prop set of a `ZitadelSession` wrapper: {@link ZitadelSessionConfig}
 * plus {@link ZitadelSessionHandlers}.
 */
export type ZitadelSessionProps = ZitadelSessionConfig & ZitadelSessionHandlers;

/* ───────────────────────  Standard element attributes  ───────────────────────
 * The one definition of which props a wrapper hands to the widget element
 * besides its own, shared by every SPA SDK except Angular (whose component tag
 * already carries them). The set and every widget prop are disjoint, which the
 * contract spec checks, so a wrapper can pass the result to the element without
 * a widget prop ever being shadowed.
 * ───────────────────────────────────────────────────────────────────────── */

/** The names every framework applies to an element itself, so none of them takes a prefix. */
const NATIVE_NAMES = ["class", "className", "style"] as const;
type NativeName = (typeof NATIVE_NAMES)[number];

const STANDARD_NAMES = [
  ...NATIVE_NAMES,
  "id",
  "title",
  "slot",
  "hidden",
  "role",
  "tabindex",
  "tabIndex",
] as const;

/**
 * @internal The name of a standard HTML attribute: the fixed ones (`className` and
 * `tabIndex` are the spellings React and Qwik use), `data-*` and `aria-*`.
 * Matching is exact and case-sensitive.
 */
export type StandardAttributeName =
  | (typeof STANDARD_NAMES)[number]
  | `data-${string}`
  | `aria-${string}`;

/**
 * @internal The standard attributes among the props `Props`, each name with `Prefix`
 * before it, except the native names. Every value keeps the type it has in
 * `Props`.
 */
export type StandardAttributes<Props extends object, Prefix extends string = ""> = {
  [Name in keyof Props & StandardAttributeName as Name extends NativeName
    ? Name
    : `${Prefix}${Name}`]?: Props[Name];
};

/**
 * @internal What a wrapper's props type adds to the widget's own: the standard attributes
 * of the framework's element attributes type `Attributes`, and nothing else, so
 * no prop the type accepts is dropped.
 */
export type StandardAttributeProps<Attributes extends object> = Pick<
  Attributes,
  Extract<keyof Attributes, StandardAttributeName>
>;

/**
 * @internal Whether `name` is the name of a standard HTML attribute (see
 * {@link StandardAttributeName}). A wrapper that needs to keep such a name away
 * from a property binding of its own asks this rather than listing the names.
 */
export function isStandardAttributeName(name: string): name is StandardAttributeName {
  return (
    STANDARD_NAMES.some((standard) => standard === name) ||
    (name.startsWith("data-") && name.length > "data-".length) ||
    (name.startsWith("aria-") && name.length > "aria-".length)
  );
}

const isEnumerated = (name: string): boolean =>
  name.startsWith("aria-") || name.startsWith("data-");

// Only a boolean attribute is absent when false; `aria-hidden="false"` and `data-open="false"` mean something.
const isOmitted = (name: string, value: unknown): boolean =>
  value == null || (value === false && !isEnumerated(name));

/**
 * @internal The standard HTML attributes among the given props: `class`, `style`, `id`,
 * `title`, `slot`, `hidden`, `role`, `tabindex`, `data-*` and `aria-*`. A widget
 * element takes these as plain DOM attributes, so a wrapper passes the result to
 * the element. Anything else is left out, so no stray prop can reach the
 * widget's configuration. A value of `undefined` or `null` is left out, and so
 * is `false` except for `aria-*` and `data-*`, which render as the string
 * `"false"`. A framework that needs the names marked (Solid writes `attr:id` as
 * an attribute) passes the `prefix` to put before each name except the native
 * ones (`class`, `className` and `style`).
 */
export function standardAttributes<Props extends object, Prefix extends string = "">(
  props: Props,
  prefix?: Prefix,
): StandardAttributes<Props, Prefix>;
// The one place the record is typed loosely: the overload above is the type callers get.
export function standardAttributes(props: object, prefix = ""): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(props)) {
    if (isStandardAttributeName(name) && !isOmitted(name, value)) {
      const native = NATIVE_NAMES.some((nativeName) => nativeName === name);
      // An `aria-*` or `data-*` boolean is written out, since not every framework renders `false`.
      record[native ? name : `${prefix}${name}`] =
        typeof value === "boolean" && isEnumerated(name) ? String(value) : value;
    }
  }
  return record;
}

/* ───────────────────────────────  Widget names  ───────────────────────────────
 * The widgets and the tag names of their elements, defined once.
 * ───────────────────────────────────────────────────────────────────────── */

/** @internal Every widget name, for code that loops over the widgets. */
export const widgetNames = ["login", "logout", "session"] as const;

/** @internal The name of a widget. */
export type WidgetName = (typeof widgetNames)[number];

/**
 * @internal The tag names of the widget elements. The elements register under these
 * names, and every SDK wrapper, spec and guard reads them from here rather than
 * spelling them out. The type ties each tag to its widget name.
 */
export const widgetTags = {
  login: "zitadel-login",
  logout: "zitadel-logout",
  session: "zitadel-session",
} as const satisfies Record<WidgetName, `zitadel-${WidgetName}`>;

/** @internal One of the widget element tag names. */
export type WidgetTag = (typeof widgetTags)[WidgetName];
