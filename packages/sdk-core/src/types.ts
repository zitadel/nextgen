import type { ZitadelProject } from "./config.js";

/**
 * What a visitor is doing when a flow starts, which selects the entry step of the flow definition
 * for that purpose.
 *
 * The SDKs declare this union themselves instead of re-exporting the type that the API client is
 * generated with. The generated client is built from the OpenAPI document and changes whenever the
 * document does, so naming it in an SDK's public types would tie every SDK release to every API
 * change. A check in this package's `types.spec.ts` fails when the two stop being identical, so
 * the union follows the server by decision, not by accident.
 *
 * - `login` signs an existing user in.
 * - `register` creates an account.
 * - `recovery` starts account recovery, for example after a forgotten password.
 * - `profiling` collects missing profile data from a user who is already signed in.
 * - `reauth` asks a signed-in user to prove who they are again before a sensitive action.
 * - `link_account` links an additional sign-in method or identity provider to the user.
 *
 * The server may add purposes, so handle an unknown one with a default branch.
 *
 * @example
 * ```tsx
 * <ZitadelLogin project={project} purpose="register" />
 * ```
 *
 * @see {@link ZitadelLoginProps}
 */
export type ZitadelFlowPurpose =
  | "login"
  | "register"
  | "recovery"
  | "profiling"
  | "reauth"
  | "link_account";

/**
 * What the widget does when a flow reaches its last step.
 *
 * - `redirect` sends the browser on to the address the flow ends with, which is what finishes an
 *   OpenID Connect or SAML sign-in.
 * - `show` renders the last step as a result screen, for example "registration confirmed", and
 *   leaves the page where it is.
 *
 * The server may add behaviors, so handle an unknown one with a default branch.
 *
 * The SDKs declare this union themselves, for the reason given at {@link ZitadelFlowPurpose}, and
 * `types.spec.ts` fails when it stops matching the API.
 *
 * @see {@link ZitadelFlowCompleteDetail.behavior}
 */
export type ZitadelFlowBehavior = "redirect" | "show";

/**
 * The part of a flow step that the SDKs promise to keep stable.
 *
 * The server returns much more for each step: the fields to render, the actions, the challenges and
 * the identity providers. That is the widget's own rendering data, it changes whenever the flow
 * model does, and an app has no reason to read it. So this contract lists only what the host page
 * needs, for example to title the page from the purpose of the step, and the check in
 * `types.spec.ts` fails if the API stops providing any of it.
 *
 * The object a listener receives is the one the server sent, so it can carry more than these
 * fields. Reading anything else is outside the contract and can break on any release.
 *
 * @example
 * ```tsx
 * <ZitadelLogin
 *   project={project}
 *   onFlowStep={({ step }) => setTitle(step.purpose ?? "login")}
 * />
 * ```
 *
 * @see {@link ZitadelFlowStepDetail.step}
 */
export interface ZitadelFlowStep {
  /**
   * The name of the step in the flow definition.
   *
   * A project chooses its own step names, so a listener must not assume a fixed set. To decide what
   * the page is for, read {@link ZitadelFlowStep.purpose} instead.
   */
  readonly name: string;
  /**
   * What the visitor is doing on this step.
   *
   * A login moves between `login` and `register` by itself: an identifier with no account
   * continues as a sign-up, and one with an account continues a sign-up as a sign-in. A page that
   * titles itself should follow this value, not {@link ZitadelFlowStep.name}, which the flow
   * definition chooses.
   *
   * @defaultValue unset, when the flow definition gives the step no purpose
   */
  readonly purpose?: ZitadelFlowPurpose;
  /**
   * A localization key that says why the flow moved to this step's purpose without being asked.
   *
   * It is set only on the step right after such a move, for example when an identifier with no
   * account continues as a sign-up. It is `null` or unset on every other step.
   *
   * @defaultValue unset
   */
  readonly notice?: string | null;
  /**
   * The localization keys of the error from the previous failed submission.
   *
   * A field-validation failure carries one key per violation, joined with `"; "`. It is `null` or
   * unset when the previous submission succeeded.
   *
   * @defaultValue unset
   */
  readonly error?: string | null;
}

/**
 * The widget contract shared by every single-page-application SDK: the event detail types, plus
 * the configuration, handler and props types derived from them.
 *
 * Each of those SDKs re-exports these types from its own public surface, so a consumer needs no
 * direct dependency on this package. The middleware types live in `@zitadel/sdk-core/middleware`.
 *
 * @packageDocumentation
 */

/**
 * The payload of the `zitadel-flow-step` event.
 *
 * The widget fires the event each time the server moves the flow to a new step, such as the
 * identifier, the password or a second factor. Listen to it to mirror progress in the host page or
 * to record analytics. The event carries no user input, only the step the server returned, so it is
 * safe to forward to an analytics tool.
 *
 * @example
 * ```ts
 * const onFlowStep = (detail: ZitadelFlowStepDetail) => {
 *   analytics.track("sign-in-step", { step: detail.step.name, purpose: detail.step.purpose });
 * };
 * ```
 */
export interface ZitadelFlowStepDetail {
  /**
   * The step the flow has just entered.
   *
   * Only the fields of {@link ZitadelFlowStep} are part of the contract. The step names belong to
   * the flow definition of the project, so a custom step reaches the listener unchanged and a
   * listener should ignore a step name it does not know.
   */
  readonly step: ZitadelFlowStep;
}

/**
 * The payload of the `zitadel-flow-input` event.
 *
 * The widget fires the event when the user changes a field in the current step. It lets a host
 * page react to typing, for example to enable its own controls, without owning the form. The
 * widget still owns the form: the listener observes the input and cannot change or cancel it.
 *
 * Do not log or store the value of a field that holds a secret. The event fires for every field of
 * a step, including the password field.
 *
 * @example
 * ```ts
 * const onFlowInput = ({ name, value }: ZitadelFlowInputDetail) => {
 *   if (name === "identifier") {
 *     submitHint.hidden = value.length === 0;
 *   }
 * };
 * ```
 */
export interface ZitadelFlowInputDetail {
  /**
   * The name of the field that changed.
   *
   * The name is the one the flow step declares for the field.
   */
  readonly name: string;
  /**
   * The new value of the field.
   *
   * The value is exactly as typed: it is neither validated nor trimmed. For a password field it is
   * the plain-text password, so never log or persist it.
   */
  readonly value: string;
}

/**
 * The detail carried by every event after which the widget navigates.
 *
 * A listener whose work must finish before the navigation, such as an asynchronous handler or a
 * lazily loaded callback, passes its promise to {@link ZitadelFlowCompleteDetail.waitUntil}. The
 * widget navigates once every registered promise has settled, or after a short timeout.
 *
 * Only the events after which the widget navigates carry it: `zitadel-flow-complete`,
 * `zitadel-flow-redirect` and `zitadel-signout`. The events that do not navigate, such as
 * `zitadel-flow-step`, have no `waitUntil`.
 */
export interface ZitadelNavigationDetail {
  /**
   * Registers work that the widget must wait for before it navigates.
   *
   * Call it synchronously from the listener, with the promise or any other value that the
   * navigation depends on. It exists so that an asynchronous handler, such as one that stores a
   * session, is not cut off by the page unloading. The widget navigates after every registered
   * promise has settled, or after a short timeout, so a handler that never settles cannot block it.
   *
   * Calling it after the listener has returned is too late: the widget has already started to wait.
   * A rejected promise does not stop the navigation either.
   *
   * @param work - The promise, or any other value, that the navigation waits for.
   *
   * @example
   * ```ts
   * const onFlowComplete = (detail: ZitadelFlowCompleteDetail) => {
   *   detail.waitUntil(saveSessionToStore(detail.handoff_token));
   * };
   * ```
   */
  readonly waitUntil: (work: unknown) => void;
}

/**
 * The payload of the `zitadel-flow-complete` event.
 *
 * The widget fires the event when the flow finishes and the user is signed in. The widget
 * navigates afterwards, so register any work that must finish first with
 * {@link ZitadelFlowCompleteDetail.waitUntil}.
 *
 * The event bubbles and is composed, so any script on the page can listen for it and read the
 * single-use `handoff_token` in its detail. The host should exchange that token itself, or set
 * `postSignInUrl` so the widget exchanges it and navigates.
 *
 * Whether the widget navigates by itself depends on the `postSignInUrl` prop of the login widget:
 * when that prop is unset, the widget leaves the handoff to the host page, so the listener is the
 * only place that learns the sign-in finished.
 */
export interface ZitadelFlowCompleteDetail extends ZitadelNavigationDetail {
  /**
   * What the server asked the client to do on completion.
   *
   * The value is exactly as the flow returned it.
   */
  readonly behavior: ZitadelFlowBehavior;
  /**
   * The address the server sends the browser to next.
   *
   * It is absent when the flow names no destination. Validate it before you navigate to it from
   * your own code: it is a server-provided address, not one the page controls.
   */
  readonly redirect_uri?: string;
  /**
   * A short-lived token that lets a different origin pick up the signed-in session.
   *
   * The server issues it only when the flow completes with a handoff, so it is absent otherwise.
   * The token is a credential until it expires: send it only to the origin it was issued for, never
   * log it, and never put it in a URL that other pages can read.
   */
  readonly handoff_token?: string;
  /**
   * The time at which {@link ZitadelFlowCompleteDetail.handoff_token} stops being accepted.
   *
   * The value is an ISO 8601 timestamp.
   */
  readonly handoff_token_expires_at?: string;
}

/**
 * The payload of the `zitadel-flow-redirect` event.
 *
 * The widget fires the event when it is about to hand the browser to an identity provider. It is
 * distinct from `zitadel-flow-complete`: nobody is signed in yet, and the flow resumes when the
 * identity provider returns the browser. The returning browser carries the flow id in the `flow`
 * query parameter, and the widget resumes from it.
 *
 * @example
 * ```ts
 * const onFlowRedirect = (detail: ZitadelFlowRedirectDetail) => {
 *   detail.waitUntil(flushAnalytics());
 * };
 * ```
 */
export interface ZitadelFlowRedirectDetail extends ZitadelNavigationDetail {
  /**
   * The identity provider address that the widget is about to send the browser to.
   */
  readonly redirect_url: string;
  /**
   * The step that triggered the redirect.
   *
   * A listener uses it to tell which identity provider the user chose.
   */
  readonly step: ZitadelFlowStep;
}

/**
 * The payload of the `zitadel-flow-error` event.
 *
 * The widget fires the event when the flow fails in a way that it cannot recover from by itself,
 * such as a network error or a server error. A wrong password or a validation problem is not an
 * error in this sense: the widget shows it inside the step and keeps the flow going.
 *
 * @example
 * ```ts
 * const onFlowError = ({ message }: ZitadelFlowErrorDetail) => {
 *   reportToMonitoring(message);
 * };
 * ```
 */
export interface ZitadelFlowErrorDetail {
  /**
   * A human-readable description of what went wrong.
   *
   * The text is meant for display and logs. It is not a stable code, so do not branch on it. It can
   * name the failing request, so keep it out of pages that other users can see.
   */
  readonly message: string;
}

/**
 * The payload of the `zitadel-signout` event.
 *
 * The `<zitadel-logout>` and `<zitadel-session>` widgets fire the event once the session has been
 * ended and before the widget navigates away. Use it to clear client-side state that belongs to
 * the user, such as a cache or a store.
 *
 * @example
 * ```ts
 * const onSignout = (detail: ZitadelSignoutDetail) => {
 *   detail.waitUntil(queryClient.clear());
 * };
 * ```
 */
export interface ZitadelSignoutDetail extends ZitadelNavigationDetail {
  /**
   * The display rendering of the signed-out user.
   *
   * It is an empty string when none was resolved.
   */
  readonly display: string;
  /**
   * The login identifier of the signed-out user.
   *
   * It is an empty string when none was resolved.
   */
  readonly identifier: string;
}

/* ───────────────────────────  Widget contract  ───────────────────────────
 * Single source of truth shared by every single-page-application SDK. The event maps below
 * declare which widget events exist and what each carries; the configuration, handler and props
 * types and the runtime name lists are all derived from them. Adding or removing an event here
 * is the one edit that reaches every SDK: the compile-time assertions in this file, the
 * `@zitadel/components` emit-conformance test and each SDK's contract-driven forwarding test
 * fail until every wrapper is brought back into line.
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * The events that the `<zitadel-login>` widget emits, keyed to their detail payloads.
 *
 * @internal
 */
export interface ZitadelLoginEventMap {
  "zitadel-flow-step": ZitadelFlowStepDetail;
  "zitadel-flow-input": ZitadelFlowInputDetail;
  "zitadel-flow-complete": ZitadelFlowCompleteDetail;
  "zitadel-flow-redirect": ZitadelFlowRedirectDetail;
  "zitadel-flow-error": ZitadelFlowErrorDetail;
}

/**
 * The events that the `<zitadel-logout>` widget emits, keyed to their detail payloads.
 *
 * @internal
 */
export interface ZitadelLogoutEventMap {
  "zitadel-signout": ZitadelSignoutDetail;
}

/**
 * The events that the `<zitadel-session>` widget emits, keyed to their detail payloads.
 *
 * The `zitadel-signout` event reuses {@link ZitadelSignoutDetail}, so the signed-in card and the
 * avatar menu speak the same sign-out contract.
 *
 * @internal
 */
export interface ZitadelSessionEventMap {
  "zitadel-signout": ZitadelSignoutDetail;
}

/**
 * The map from each `<zitadel-login>` event to the callback prop that the SDKs expose for it.
 *
 * The `satisfies` clause is the drift lock: every event needs exactly one handler entry, so a
 * missing entry, or an extra one left behind for a removed event, fails the type check. The
 * handler types and the event name list derive from this map.
 *
 * @internal
 */
export const ZITADEL_LOGIN_EVENT_HANDLERS = {
  "zitadel-flow-step": "onFlowStep",
  "zitadel-flow-input": "onFlowInput",
  "zitadel-flow-complete": "onFlowComplete",
  "zitadel-flow-redirect": "onFlowRedirect",
  "zitadel-flow-error": "onFlowError",
} as const satisfies Record<keyof ZitadelLoginEventMap, `on${string}`>;

/**
 * The map from the `<zitadel-logout>` event to the callback prop that the SDKs expose for it.
 *
 * @internal
 */
export const ZITADEL_LOGOUT_EVENT_HANDLERS = {
  "zitadel-signout": "onSignout",
} as const satisfies Record<keyof ZitadelLogoutEventMap, `on${string}`>;

/**
 * The map from the `<zitadel-session>` event to the callback prop that the SDKs expose for it.
 *
 * @internal
 */
export const ZITADEL_SESSION_EVENT_HANDLERS = {
  "zitadel-signout": "onSignout",
} as const satisfies Record<keyof ZitadelSessionEventMap, `on${string}`>;

/**
 * The runtime list of the `<zitadel-login>` event names.
 *
 * It drives the event wiring in the SDK wrappers and the drift tests.
 *
 * @internal
 */
export const ZITADEL_LOGIN_EVENTS = Object.keys(
  ZITADEL_LOGIN_EVENT_HANDLERS,
) as (keyof ZitadelLoginEventMap)[];

/**
 * The runtime list of the `<zitadel-logout>` event names.
 *
 * @internal
 */
export const ZITADEL_LOGOUT_EVENTS = Object.keys(
  ZITADEL_LOGOUT_EVENT_HANDLERS,
) as (keyof ZitadelLogoutEventMap)[];

/**
 * The runtime list of the `<zitadel-session>` event names.
 *
 * @internal
 */
export const ZITADEL_SESSION_EVENTS = Object.keys(
  ZITADEL_SESSION_EVENT_HANDLERS,
) as (keyof ZitadelSessionEventMap)[];

/**
 * The configuration props shared by every `ZitadelLogin` wrapper.
 *
 * They are the attributes of the `<zitadel-login>` element in camel case, so the SDKs forward them
 * one to one instead of each inventing its own names. Every prop is optional, and the props are
 * read when the widget mounts: do not rely on a change to a prop after mount to restart a running
 * flow.
 *
 * @example
 * ```tsx
 * <ZitadelLogin
 *   projectId="296547382910273"
 *   variant="page"
 *   postSignInUrl="/dashboard"
 *   onFlowError={({ message }) => console.error(message)}
 * />
 * ```
 */
export interface ZitadelLoginConfig {
  /**
   * The project handle that the widget signs users in to.
   *
   * When set, the handle supplies the project id and the same-origin proxy path, and the
   * {@link ZitadelLoginProps.projectId} and {@link ZitadelLoginProps.proxyPath} props are
   * ignored. Use it when the app calls `configureZitadel` and has the handle at hand. The handle
   * is the one place the project id and the proxy path are configured, so passing it keeps the
   * widget and the rest of the app in agreement.
   */
  readonly project?: ZitadelProject;
  /**
   * The project id that the widget signs users in to.
   *
   * Use it in an app that does not use a project handle. It is ignored when
   * {@link ZitadelLoginProps.project} is set. A session counts as signed in only for this project,
   * so a wrong id makes every sign-in read as signed out.
   *
   * @example "296547382910273"
   */
  readonly projectId?: string;
  /**
   * The path prefix of the same-origin proxy that the widget calls instead of the auth backend.
   *
   * Calling the proxy keeps the session cookie first-party and needs no CORS setup. The server
   * middleware of the SDK serves the proxy. It is ignored when {@link ZitadelLoginProps.project}
   * is set. Change it only when the proxy is mounted somewhere else, and keep the value equal to
   * the `proxyPath` of the server middleware. Sign-in with an external identity provider needs the
   * default, because the provider returns to a callback path under that prefix.
   *
   * @defaultValue "/__nextgen"
   * @example "/__nextgen"
   */
  readonly proxyPath?: string;
  /**
   * The sizing and chrome mode of the widget.
   *
   * The `widget` mode is sized to its content and paints no page chrome, which suits embedding
   * inside an existing layout. The `page` mode claims the viewport, paints the surface background,
   * loads the brand font and focuses the first field, which suits a dedicated sign-in route.
   *
   * @defaultValue "widget"
   */
  readonly variant?: "widget" | "page";
  /**
   * The color mode of the widget.
   *
   * When unset, the mode comes from the `branding.theme.mode` of the tenant, then from the default
   * of the {@link ZitadelLoginProps.variant}: `dark` for `page` and `auto` for `widget`. The
   * `auto` mode follows `prefers-color-scheme`. Set it when the surface of the app is fixed, so
   * the widget does not render a dark card on a light page.
   *
   * @example "light"
   */
  readonly theme?: "light" | "dark" | "auto";
  /**
   * Whether to hide the heading block of the widget visually.
   *
   * The heading stays in the accessibility tree. Use it in an embed whose page already carries
   * the heading, such as a brand-voice title above the card, so the card does not repeat it.
   *
   * @defaultValue false
   */
  readonly suppressHeader?: boolean;
  /**
   * Whether to hide the show and hide button on password fields.
   *
   * The button is shown by default, as NIST SP 800-63B recommends.
   *
   * @defaultValue false
   */
  readonly suppressPasswordToggle?: boolean;
  /**
   * The purpose of the flow.
   *
   * @defaultValue "login"
   */
  readonly purpose?: ZitadelFlowPurpose;
  /**
   * The name of the flow definition to run.
   *
   * It selects a definition by the `name` field of the flow file. When unset, the widget runs the
   * default flow of the project for the {@link ZitadelLoginProps.purpose}.
   */
  readonly flowName?: string;
  /**
   * The address to navigate to after a completed sign-in.
   *
   * When the `next` query parameter of the page names a path on the same origin, the widget
   * returns to that path instead, unless {@link ZitadelLoginProps.forcePostSignInUrl} is set. The
   * server SDKs set the parameter when they send a signed-out request for a protected route to
   * the login page, so a user who asked for `/dashboard` lands on `/dashboard` and not on a fixed
   * page.
   *
   * The widget follows `next` only when it is a plain path on the page's own origin. A full URL,
   * a scheme such as `javascript:`, a protocol-relative `//host`, a backslash, a control
   * character, or dot segments that collapse to `//host` are all refused, which closes the open
   * redirect. A refused `next` falls back to this prop.
   *
   * When this prop is unset, the widget does not navigate after sign-in and leaves the handoff to
   * the host page, which can act in the `zitadel-flow-complete` handler.
   *
   * @example "/dashboard"
   */
  readonly postSignInUrl?: string;
  /**
   * Whether to navigate to {@link ZitadelLoginProps.postSignInUrl} even when the `next` query
   * parameter names a path.
   *
   * Set it on a page that uses `next` for something of its own, or whose router needs a prefix
   * that the plain `next` path lacks, such as an app mounted under `/ui/console`.
   *
   * @defaultValue false
   */
  readonly forcePostSignInUrl?: boolean;
  /**
   * The id of an existing flow to resume instead of starting a new one.
   *
   * Use it to continue a flow that was kept across a reload. When unset or `null`, the widget
   * falls back to the `flow` query parameter that an identity provider callback brings back. An id
   * that no longer resolves starts a new flow. An identity provider callback returns the browser
   * with a `flow` query parameter, and the widget resumes from it without this prop.
   *
   * @example "flw_01HZX8"
   */
  readonly resumeFlowId?: string | null;
  /**
   * Copy overrides, keyed by primary language subtag.
   *
   * Each dictionary is merged over the builtin locale dictionary and may be partial, so presets
   * such as the `businessLocales` overlay of the components package are directly assignable. This
   * is how custom flow steps and actions get their labels: the keys follow the patterns
   * `<step>.title`, `<step>.action.<name>` and `<step>.field.<field>`. The keys of a language that
   * the builtin locales lack must cover every string that the step shows.
   *
   * @example
   * ```tsx
   * <ZitadelLogin locales={{ en: { "identifier.title": "Welcome back" } }} />
   * ```
   */
  readonly locales?: Record<string, Partial<Record<string, string>>>;
  /**
   * The BCP 47 language tag that overrides the language of the widget.
   *
   * When unset, the widget uses the language of the browser. A tag without a matching dictionary
   * falls back to the builtin English copy.
   *
   * @example "de-CH"
   */
  readonly lang?: string;
}

/**
 * The configuration props shared by every `ZitadelLogout` wrapper.
 *
 * They are the attributes of the `<zitadel-logout>` element in camel case.
 */
export interface ZitadelLogoutConfig {
  /**
   * The project handle that the widget signs users in to.
   *
   * When set, the handle supplies the project id and the same-origin proxy path, and the
   * {@link ZitadelLogoutProps.projectId} and {@link ZitadelLogoutProps.proxyPath} props are
   * ignored. Use it when the app calls `configureZitadel` and has the handle at hand. The handle
   * is the one place the project id and the proxy path are configured, so passing it keeps the
   * widget and the rest of the app in agreement.
   */
  readonly project?: ZitadelProject;
  /**
   * The project id that the widget signs users in to.
   *
   * Use it in an app that does not use a project handle. It is ignored when
   * {@link ZitadelLogoutProps.project} is set. A session counts as signed in only for this project,
   * so a wrong id makes every sign-in read as signed out.
   *
   * @example "296547382910273"
   */
  readonly projectId?: string;
  /**
   * The path prefix of the same-origin proxy that the widget calls instead of the auth backend.
   *
   * Calling the proxy keeps the session cookie first-party and needs no CORS setup. The server
   * middleware of the SDK serves the proxy. It is ignored when {@link ZitadelLogoutProps.project}
   * is set. Change it only when the proxy is mounted somewhere else, and keep the value equal to
   * the `proxyPath` of the server middleware. Sign-in with an external identity provider needs the
   * default, because the provider returns to a callback path under that prefix.
   *
   * @defaultValue "/__nextgen"
   * @example "/__nextgen"
   */
  readonly proxyPath?: string;
  /**
   * The address to navigate to after sign-out.
   *
   * When unset, the page stays where it is once the session has ended. Set it for a page that
   * only makes sense signed in, so the user does not stay on it after signing out.
   *
   * @example "/login"
   */
  readonly postSignOutUrl?: string;
  /**
   * The color mode of the widget.
   *
   * When unset, the mode is `auto`, which follows `prefers-color-scheme`, because the control
   * lives inside the chrome of the app. Set it when the surrounding surface is fixed.
   *
   * @defaultValue "auto"
   */
  readonly theme?: "light" | "dark" | "auto";
}

/**
 * The configuration props shared by every `ZitadelSession` wrapper.
 *
 * They are the attributes of the `<zitadel-session>` element in camel case.
 */
export interface ZitadelSessionConfig {
  /**
   * The project handle that the widget signs users in to.
   *
   * When set, the handle supplies the project id and the same-origin proxy path, and the
   * {@link ZitadelSessionProps.projectId} and {@link ZitadelSessionProps.proxyPath} props are
   * ignored. Use it when the app calls `configureZitadel` and has the handle at hand. The handle
   * is the one place the project id and the proxy path are configured, so passing it keeps the
   * widget and the rest of the app in agreement.
   */
  readonly project?: ZitadelProject;
  /**
   * The project id that the widget signs users in to.
   *
   * Use it in an app that does not use a project handle. It is ignored when
   * {@link ZitadelSessionProps.project} is set. A session counts as signed in only for this project,
   * so a wrong id makes every sign-in read as signed out.
   *
   * @example "296547382910273"
   */
  readonly projectId?: string;
  /**
   * The path prefix of the same-origin proxy that the widget calls instead of the auth backend.
   *
   * Calling the proxy keeps the session cookie first-party and needs no CORS setup. The server
   * middleware of the SDK serves the proxy. It is ignored when
   * {@link ZitadelSessionProps.project} is set. Change it only when the proxy is mounted
   * somewhere else, and keep the value equal to the `proxyPath` of the server middleware. Sign-in
   * with an external identity provider needs the default, because the provider returns to a
   * callback path under that prefix.
   *
   * @defaultValue "/__nextgen"
   * @example "/__nextgen"
   */
  readonly proxyPath?: string;
  /**
   * The address to navigate to after sign-out.
   *
   * When unset, the page stays where it is once the session has ended. Set it for a page that
   * only makes sense signed in, so the user does not stay on it after signing out.
   *
   * @example "/login"
   */
  readonly postSignOutUrl?: string;
  /**
   * The heading of the card.
   *
   * It replaces the builtin heading, for copy or a language that the builtin locales lack.
   */
  readonly heading?: string;
  /**
   * The label of the sign-out action on the card.
   *
   * It replaces the builtin label.
   */
  readonly logoutLabel?: string;
  /**
   * The sizing and chrome mode of the widget.
   *
   * The `widget` mode is sized to its content and paints no page chrome, which suits embedding the
   * signed-in card inside an existing layout. The `page` mode claims the viewport and paints the
   * surface background, which suits a dedicated signed-in route.
   *
   * @defaultValue "widget"
   */
  readonly variant?: "widget" | "page";
  /**
   * The color mode of the widget.
   *
   * When unset, the mode comes from the default of the {@link ZitadelSessionProps.variant}:
   * `dark` for `page` and `auto` for `widget`. The `auto` mode follows `prefers-color-scheme`. Set
   * it when the surface of the app is fixed, so the card does not render dark on a light page.
   */
  readonly theme?: "light" | "dark" | "auto";
  /**
   * Whether to hide the heading block of the widget visually.
   *
   * The heading stays in the accessibility tree. Use it in an embed whose page already carries
   * the heading, such as a brand-voice title above the card, so the card does not repeat it.
   *
   * @defaultValue false
   */
  readonly suppressHeader?: boolean;
}

/**
 * The callback props for the `<zitadel-login>` events.
 *
 * The props are `onFlowStep`, `onFlowInput`, `onFlowComplete`, `onFlowRedirect` and `onFlowError`.
 * Each receives the matching detail type, such as {@link ZitadelFlowStepDetail}. They are plain
 * callbacks rather than DOM events, so every framework wrapper exposes the same props. The set is
 * derived from the event list of the widget, so it cannot drift from the events that the widget
 * emits.
 *
 * A handler for an event after which the widget navigates may return a promise, but the widget
 * does not wait for it. Register the work with {@link ZitadelFlowCompleteDetail.waitUntil} instead.
 *
 * @example
 * ```tsx
 * const handlers: ZitadelLoginHandlers = {
 *   onFlowComplete: (detail) => detail.waitUntil(refreshSession()),
 *   onFlowError: ({ message }) => console.error(message),
 * };
 * ```
 */
export type ZitadelLoginHandlers = {
  readonly [E in keyof ZitadelLoginEventMap as (typeof ZITADEL_LOGIN_EVENT_HANDLERS)[E]]?: (
    detail: ZitadelLoginEventMap[E],
  ) => ZitadelLoginEventMap[E] extends ZitadelNavigationDetail ? unknown : void;
};

/**
 * The callback prop for the `<zitadel-logout>` event.
 *
 * The prop is `onSignout`, which receives a {@link ZitadelSignoutDetail}. It is derived from the
 * event list of the widget in the same way as the callback props of {@link ZitadelLoginProps}.
 *
 * @example
 * ```tsx
 * const handlers: ZitadelLogoutHandlers = { onSignout: () => queryClient.clear() };
 * ```
 */
export type ZitadelLogoutHandlers = {
  readonly [E in keyof ZitadelLogoutEventMap as (typeof ZITADEL_LOGOUT_EVENT_HANDLERS)[E]]?: (
    detail: ZitadelLogoutEventMap[E],
  ) => ZitadelLogoutEventMap[E] extends ZitadelNavigationDetail ? unknown : void;
};

/**
 * The callback prop for the `<zitadel-session>` event.
 *
 * The prop is `onSignout`, which receives a {@link ZitadelSignoutDetail}. It is derived from the
 * event list of the widget in the same way as the callback props of {@link ZitadelLoginProps}.
 *
 * @example
 * ```tsx
 * const handlers: ZitadelSessionHandlers = { onSignout: () => queryClient.clear() };
 * ```
 */
export type ZitadelSessionHandlers = {
  readonly [E in keyof ZitadelSessionEventMap as (typeof ZITADEL_SESSION_EVENT_HANDLERS)[E]]?: (
    detail: ZitadelSessionEventMap[E],
  ) => ZitadelSessionEventMap[E] extends ZitadelNavigationDetail ? unknown : void;
};

/**
 * The full prop set of a `ZitadelLogin` wrapper.
 *
 * It combines the configuration props with the event callback props, so a wrapper forwards
 * both to the widget. The props type of each SDK wrapper builds on it.
 */
export type ZitadelLoginProps = ZitadelLoginConfig & ZitadelLoginHandlers;

/**
 * The full prop set of a `ZitadelLogout` wrapper.
 *
 * It combines the configuration props with the `onSignout` callback prop.
 */
export type ZitadelLogoutProps = ZitadelLogoutConfig & ZitadelLogoutHandlers;

/**
 * The full prop set of a `ZitadelSession` wrapper.
 *
 * It combines the configuration props with the `onSignout` callback prop.
 */
export type ZitadelSessionProps = ZitadelSessionConfig & ZitadelSessionHandlers;

/* ───────────────────────  Standard element attributes  ───────────────────────
 * The one definition of which props a wrapper hands to the widget element besides its own,
 * shared by every single-page-application SDK except Angular, whose component tag already
 * carries them. The set and every widget prop are disjoint, which the contract spec checks, so a
 * wrapper can pass the result to the element without a widget prop ever being shadowed.
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * The names that every framework applies to an element itself, so none of them takes a prefix.
 */
const NATIVE_NAMES = ["class", "className", "style"] as const;
type NativeName = (typeof NATIVE_NAMES)[number];

/**
 * The fixed names of the standard HTML attributes, native names included.
 */
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
 * The name of a standard HTML attribute.
 *
 * It is one of the fixed names, or any `data-*` or `aria-*` name. The names `className` and
 * `tabIndex` are the spellings that React and Qwik use. Matching is exact and case-sensitive.
 *
 * @internal
 */
export type ZitadelStandardAttributeName =
  | (typeof STANDARD_NAMES)[number]
  | `data-${string}`
  | `aria-${string}`;

/**
 * The standard attributes among the props of a type, each name with a prefix before it.
 *
 * The native names keep their spelling. Every value keeps the type that it has in the props.
 *
 * @typeParam Props - The type of the props to pick the standard attributes from.
 * @typeParam Prefix - The text to put before each name except the native ones.
 *
 * @internal
 */
export type ZitadelStandardAttributes<Props extends object, Prefix extends string = ""> = {
  [Name in keyof Props & ZitadelStandardAttributeName as Name extends NativeName
    ? Name
    : `${Prefix}${Name}`]?: Props[Name];
};

/**
 * What the props type of a wrapper adds to the props of the widget.
 *
 * It is the standard attributes of the attributes type of the framework, and nothing else, so no
 * prop that the type accepts is dropped.
 *
 * @typeParam Attributes - The element attributes type of the framework.
 *
 * @internal
 */
export type ZitadelStandardAttributeProps<Attributes extends object> = Pick<
  Attributes,
  Extract<keyof Attributes, ZitadelStandardAttributeName>
>;

/**
 * Returns whether a name is the name of a standard HTML attribute.
 *
 * A wrapper that must keep such a name away from a property binding of its own asks this instead
 * of listing the names. The accepted names are the fixed standard names, `data-*` and `aria-*`.
 *
 * @param name - The name to test.
 * @returns `true` when the name is a standard attribute name.
 *
 * @internal
 */
export function isStandardAttributeName(name: string): name is ZitadelStandardAttributeName {
  return (
    STANDARD_NAMES.some((standard) => standard === name) ||
    (name.startsWith("data-") && name.length > "data-".length) ||
    (name.startsWith("aria-") && name.length > "aria-".length)
  );
}

/**
 * Returns whether a name is `data-*` or `aria-*`, whose `false` value is meaningful.
 *
 * @param name - The attribute name.
 * @returns `true` when the name starts with `aria-` or `data-`.
 */
const isEnumerated = (name: string): boolean =>
  name.startsWith("aria-") || name.startsWith("data-");

/**
 * Returns whether an attribute is left out of the result.
 *
 * Only a boolean attribute is absent when `false`; `aria-hidden="false"` and `data-open="false"`
 * mean something.
 *
 * @param name - The attribute name.
 * @param value - The attribute value.
 * @returns `true` when the value is `undefined`, `null`, or `false` on a boolean attribute.
 */
const isOmitted = (name: string, value: unknown): boolean =>
  value == null || (value === false && !isEnumerated(name));

/**
 * Picks the standard HTML attributes from the given props.
 *
 * The standard attributes are `class`, `style`, `id`, `title`, `slot`, `hidden`, `role`,
 * `tabindex`, `data-*` and `aria-*`. A widget element takes these as plain DOM attributes, so a
 * wrapper passes the result to the element. Anything else is left out, so no stray prop can reach
 * the configuration of the widget.
 *
 * A value of `undefined` or `null` is left out, and so is `false`, except for `aria-*` and
 * `data-*`, which render as the string `"false"`. A framework that needs the names marked, as
 * Solid does when it writes `attr:id`, passes the prefix to put before each name except the native
 * ones: `class`, `className` and `style`.
 *
 * The function is a filter on purpose: it keeps an arbitrary prop of a wrapper from reaching the
 * widget as a configuration attribute, and the standard names are disjoint from every widget prop.
 *
 * @example
 * ```ts
 * standardAttributes({ id: "login", "aria-busy": false, projectId: "1" });
 * // { id: "login", "aria-busy": "false" }
 * standardAttributes({ id: "login" }, "attr:");
 * // { "attr:id": "login" }
 * ```
 *
 * @typeParam Props - The type of the props to pick from.
 * @typeParam Prefix - The type of the prefix.
 * @param props - The props of the wrapper.
 * @param prefix - The text to put before each name except the native ones.
 * @returns The standard attributes, ready to pass to the widget element.
 */
export function standardAttributes<Props extends object, Prefix extends string = "">(
  props: Props,
  prefix?: Prefix,
): ZitadelStandardAttributes<Props, Prefix>;
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

/**
 * Every widget name, for code that loops over the widgets.
 *
 * @internal
 */
export const widgetNames = ["login", "logout", "session"] as const;

/**
 * The name of a widget.
 *
 * @internal
 */
export type ZitadelWidgetName = (typeof widgetNames)[number];

/**
 * The tag names of the widget elements.
 *
 * The elements register under these names, and every SDK wrapper, spec and guard reads them from
 * here instead of spelling them out. The type ties each tag to its widget name.
 *
 * @internal
 */
export const widgetTags = {
  login: "zitadel-login",
  logout: "zitadel-logout",
  session: "zitadel-session",
} as const satisfies Record<ZitadelWidgetName, `zitadel-${ZitadelWidgetName}`>;

/**
 * The tag name of a widget element.
 *
 * @internal
 */
export type ZitadelWidgetTag = (typeof widgetTags)[ZitadelWidgetName];
