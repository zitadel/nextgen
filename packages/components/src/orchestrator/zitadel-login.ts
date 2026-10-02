import type {
  CreateFlow201,
  CreateFlow201Step,
  CreateFlow201StepFieldsItem,
  CreateFlowBodyPurpose,
  SubmitFlowStepBody,
  SubmitFlowStepBodyChallengeResponse,
  SubmitFlowStepBodyFields,
} from "@zitadel/api/generated/model";
import type { Liquid, Template } from "liquidjs";

import { type ZitadelProject } from "@zitadel/api/config";
import { ApiError, apiErrorMessage } from "@zitadel/api/runtime/fetch";
import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

import "../atoms/index.js";
import type { Branding } from "./branding.js";
import type { FlowError, FlowIdentity, LiquidContext } from "./template-context.js";
import type { ResolvedTheme } from "./theme-controller.js";

import { zitadelTrustmarkInnerHtml } from "../internal/attribution-markup.js";
import { emit } from "../internal/emit.js";
import { escapeHtml } from "../internal/escape-html.js";
import {
  exchangeSession,
  getCurrentStep,
  startFlow as apiStartFlow,
  submitStep as apiSubmitStep,
} from "./api-client.js";
import { armAssetFallbacks } from "./asset-fallback.js";
import { validateBranding } from "./branding-validator.js";
import { resolveLogoUrl } from "./branding.js";
import { stampExportparts } from "./exportparts.js";
import { createLiquidEngine, localiseFlowErrorKeys, parseSsoError } from "./liquid.js";
import { en, builtinLocales, type Locale } from "./locales/index.js";
import { patchMandatoryGates } from "./mandatory-gates.js";
import { resolveApi, type ProjectAttrs } from "./resolve-api.js";
import { createSanitiser } from "./sanitiser.js";
import { ZitadelSurface } from "./surface.js";
import { TEMPLATE_NAMES } from "./template-names.js";
import layoutChromeCss from "./templates/layout-chrome.css?inline";

/**
 * The uniform value contract every input atom exposes (`<zl-field>`,
 * `<zl-select>`, `<zl-checkbox>`, and any future field atom). The orchestrator
 * reads and restores field values exclusively through `formValue`, so it never
 * has to know an atom's tag or internal shape — a new field type works with no
 * change here.
 */
type FieldAtom = HTMLElement & { formValue: string };

/**
 * The reserved action that starts an external sign-in, fixed by the flow
 * submit contract (`flow-submit-request.yaml`): it is the one action name the
 * engine interprets itself rather than looking up in the step's actions.
 */
const SSO_ACTION = "sso";

/** Narrow a rendered named element to the `formValue` field-atom contract. */
function isFieldAtom(el: Element): el is FieldAtom {
  return typeof (el as Partial<FieldAtom>).formValue === "string";
}

/**
 * `<zitadel-login>` — the auth-UI orchestrator.
 *
 * Drives the typed `@zitadel/api` Flow API directly: `POST /flow`
 * starts a flow, `POST /flow/{id}/submit` advances it. Renders each step
 * through LiquidJS, sanitises the output via DOMPurify, and mounts the
 * result inside a real `<form>` element in its Shadow DOM via Lit's
 * `unsafeHTML` directive. Atom CustomEvents (`zl-input` / `zl-submit`)
 * and the form's native `submit` event feed back into the
 * submit cycle.
 *
 * Form participation: the orchestrator owns the `<form>` so Enter submits,
 * browsers offer "save password" prompts, and password managers / autofill
 * see a real form. Each `<zl-field>` is form-associated (see
 * `docs/design/branding/form-participation.md`) so its value participates in
 * the form even though it lives inside its own shadow root. The shadow root
 * also delegates focus, and after each step swap focus moves to the first
 * field so screen-reader and keyboard users land in a sensible spot.
 *
 * Session/state: the server is stateless between requests — a `_zflow`
 * HttpOnly cookie carries orchestration state. We always run with
 * `credentials: "include"` (set in `api-client.ts`). The flow handle (`id`)
 * may rotate on pivots/pops; we re-read it from every response.
 *
 * Spec sources:
 * - `docs/design/flowengine/flow-engine-guide.md`
 * - `docs/design/branding/templates.md`
 * - `docs/design/branding/tokens.md`
 * - `docs/design/branding/schema.md`
 * - `docs/design/branding/form-participation.md`
 * - `docs/design/flowengine/template-security.md`
 */

/**
 * The flow handle a provider callback left in the URL, if any.
 *
 * The identity-provider callback finishes by navigating the browser back to
 * the `return_target` the sso submission sent, which is the page the sign-in
 * started on with `?flow=<id>` set (see {@link returnTargetFor}) -- a full
 * page load, so nothing of the previous document survives to carry the
 * handle. Reading it here means every host page resumes correctly without
 * code of its own; doing it per framework would mean the same few lines in
 * each of the scaffolded templates, and a page that forgot them would silently
 * restart the flow instead of completing the sign-in.
 *
 * A handle from the URL is not a capability: `GET /flow/{id}` only answers
 * when the sealed flow cookie names that same id, so an id someone else put
 * there resolves to nothing.
 */
function flowIdFromLocation(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return new URLSearchParams(window.location.search).get(FLOW_QUERY_PARAM) ?? "";
  } catch {
    return "";
  }
}

/** The query parameter the orchestrator reads the flow id from after a provider callback. */
const FLOW_QUERY_PARAM = "flow";

/**
 * The page URL the callback sends the browser back to, with this flow's id
 * in the query so the reload resumes the flow (see {@link flowIdFromLocation}).
 * Set, not appended: a page already carrying `?flow=` from an earlier return
 * would otherwise send two ids.
 */
function returnTargetFor(flowId: string): string {
  const target = new URL(window.location.href);
  target.searchParams.set(FLOW_QUERY_PARAM, flowId);
  return target.toString();
}

@customElement("zitadel-login")
export class ZitadelLogin extends ZitadelSurface {
  static override shadowRootOptions: ShadowRootInit = {
    ...LitElement.shadowRootOptions,
    delegatesFocus: true,
  };

  // Host layout defaults. A bare custom element is inline-level, which makes
  // it collapse to content width when dropped into a `display: flex` parent
  // and never reach the orchestrator's intended full-bleed shell. We claim
  // the page by default; host pages that want to constrain the orchestrator
  // can still set `width`/`min-height` on the element directly.
  static override styles = css`
    :host {
      display: block;
      width: 100%;
    }
  `;

  // `variant` and `theme` come from `ZitadelSurface`. Login adds one
  // variant-specific behavior on top of the shared surface polarity: `page`
  // focuses the first field on load, `widget` never steals focus.

  @property({ type: String }) accessor purpose: CreateFlowBodyPurpose = "login";

  /**
   * Name of the flow definition to run, matching the `name` in its flow
   * file. When set, the server resolves that definition directly instead
   * of picking one by audience. Omit to run the project's default flow.
   */
  @property({ type: String, attribute: "flow-name" }) accessor flowName = "";

  /**
   * SDK project handle returned by `configureZitadel()`. Set from JS (or a
   * framework binding). When set, takes precedence over both the
   * `project-id`/`proxy-path`/`url` attributes and the global singleton from
   * `getZitadelConfig()`.
   */
  @property({ attribute: false }) accessor project: ZitadelProject | undefined;

  /**
   * Project ID, set declaratively in HTML. Lets the component be configured on
   * a plain page without JS or `configureZitadel()`. Ignored when the `project`
   * property or a `configureZitadel()` global is set. See {@link projectAttrs}.
   */
  @property({ type: String, attribute: "project-id" }) accessor projectId = "";

  /**
   * Proxy path for API requests (e.g. `/__nextgen`), set declaratively in HTML.
   * Defaults to `/__nextgen` when omitted, matching `configureZitadel()`.
   */
  @property({ type: String, attribute: "proxy-path" }) accessor proxyPath = "";

  /**
   * Full URL of the Zitadel auth backend, set declaratively in HTML. Optional —
   * not needed in client-only setups.
   */
  @property({ type: String }) accessor url = "";

  /**
   * URL to navigate to after a successful embedded sign-in. When set, the
   * orchestrator exchanges the terminal `handoff_token` via the generated
   * API client (setting the session cookie) and then performs a full
   * navigation to this URL so host middleware can observe the cookie.
   * For `complete: "redirect"` the orchestrator follows `redirect_uri`
   * instead and does not run the exchange.
   */
  @property({ type: String, attribute: "post-sign-in-url" }) accessor postSignInUrl = "";

  /**
   * Existing flow handle to resume rather than start a new flow. When set,
   * the orchestrator hits `GET /flow/{id}` instead of `POST /flow` on
   * mount, so a page reload after a network blip can re-render the same
   * step without losing collected state. A handle that no longer resolves
   * starts a new flow instead, with a console warning.
   *
   * Leaving it empty falls back to the `flow` query parameter, which is how a
   * provider callback hands the flow back (see {@link flowIdFromLocation}), so
   * a host page needs no code of its own for external sign-in to finish.
   */
  @property({ type: String, attribute: "resume-flow-id" }) accessor resumeFlowId = "";

  /**
   * Preview mode, for an operator surface such as the console's branding
   * screen. Set, the element starts the flow as usual so the step it paints
   * is the one the project serves, then shows it in the named state and
   * submits nothing: form submits, actions, back and passkey ceremonies are
   * dropped, and no completion is acted on. Fields stay editable so focus
   * and filled styling can be seen. Changing the value re-applies the state
   * to the step already loaded; it does not start another flow.
   *
   * - `default`: the step as a visitor first sees it.
   * - `validation_error`: every required field flagged, as an empty submit
   *   would be.
   * - `submission_error`: the form-level banner a failed submit shows.
   * - `loading`: the busy treatment of a submit in flight.
   * - `success`: the terminal screen. It is the step named by
   *   {@link previewSuccessStep}, since the flow's own terminal step is not
   *   known until the server walks the flow to it.
   *
   * Only the purpose's entry step can be previewed: a later step exists
   * only once the server has walked the flow to it.
   */
  @property({ type: String, attribute: "preview-state" }) accessor previewState:
    | LoginPreviewState
    | "" = "";

  /**
   * The terminal step the `success` preview paints, for a flow definition that
   * names it differently from the default flow's `done`. Its texts follow the
   * server's `<step>.title` / `<step>.description` convention.
   */
  @property({ type: String, attribute: "preview-success-step" }) accessor previewSuccessStep = "";

  /**
   * The preview state in effect: {@link previewState} when it names a known
   * state, otherwise none, so a mistyped attribute leaves a working login
   * rather than one that silently submits nothing.
   */
  private get preview(): LoginPreviewState | "" {
    const state = this.previewState;
    return (LOGIN_PREVIEW_STATES as readonly string[]).includes(state) ? state : "";
  }

  /**
   * BCP 47 language tag (e.g. `"de"`, `"en-US"`). The widget resolves this
   * to a built-in locale dictionary. Falls back to auto-detection from
   * `document.documentElement.lang` or `navigator.language` when empty.
   */
  @property({ type: String }) override accessor lang = "";

  /**
   * Custom locale dictionaries keyed by language code. Entries may be
   * partial — each is merged over the built-in dictionary for its language,
   * so a preset like {@link businessLocales} (or a hand-written subset) is
   * directly assignable:
   *
   * ```ts
   * import { businessLocales } from "@zitadel/components";
   * loginElement.locales = businessLocales;
   * // or override individual keys:
   * loginElement.locales = { en: { "identifier.title": "Welcome" } };
   * ```
   */
  @property({ attribute: false }) accessor locales:
    | Readonly<Record<string, Partial<Locale>>>
    | undefined;

  @state() private accessor response: CreateFlow201 | null = null;

  @state() private accessor branding: Branding | undefined = undefined;

  @state() private accessor loading = false;

  /** Terminal step that navigates away, so its screen is never painted. */
  @state() private accessor completing = false;

  @state() private accessor startupError: string | null = null;

  @state() private accessor formValues: Record<string, string> = {};

  /**
   * The step the server served, kept while previewing so every preview state
   * derives from the same response rather than from the last one shown.
   */
  private previewBase: CreateFlow201 | null = null;

  /**
   * Set while the next commit repaints a preview state, so `updated` treats
   * it like a theme flip (restore typed values, leave focus alone) rather
   * than a step swap that moves focus into the form. Non-reactive.
   */
  private previewRepaint = false;

  private engine: Liquid | null = null;

  /**
   * The theme the last commit rendered with. The template output carries the
   * resolved side's mark, so a theme change rewrites the string and
   * `unsafeHTML` rebuilds the form — which drops what the visitor had typed
   * unless it is put back.
   */
  private lastRenderedTheme: ResolvedTheme | null = null;

  private readonly sanitise = createSanitiser();

  /**
   * Cached compiled tenant template, keyed by source string. Re-rendering on
   * every `formValues` change otherwise re-parses the same template.
   */
  private tenantTemplateCache: { source: string; template: Template[] } | null = null;

  /**
   * Whether the widget currently owns a same-document history entry (the
   * "sentinel"). The sentinel exists so the browser's back gesture fires
   * `popstate` instead of leaving the page. Exactly one sentinel is on
   * the stack at a time: it is pushed when a step with a `kind: "back"`
   * action renders, re-armed by `onPopState` after the browser consumes
   * it, and retired by `applyResponse` when a step without a back action
   * renders. The entry reuses the current URL, so the host page's
   * location (including any hash-router fragment) is never modified.
   */
  private armed = false;

  /**
   * Set immediately before a self-initiated `history.back()` so the
   * resulting `popstate` is ignored instead of being interpreted as a
   * user back gesture.
   */
  private ignoreNextPop = false;

  /** Bound `popstate` handler stored for cleanup in `disconnectedCallback`. */
  private readonly handlePopState = this.onPopState.bind(this);

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();
    if (root instanceof ShadowRoot) {
      // jsdom 29 partially implements `adoptedStyleSheets` — the property
      // exists but isn't iterable. Treat a missing iterable as the empty
      // list so the orchestrator boots in unit tests without crashing.
      const existing: readonly CSSStyleSheet[] = Array.isArray(root.adoptedStyleSheets)
        ? root.adoptedStyleSheets
        : [];
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(layoutChromeCss);
      root.adoptedStyleSheets = [...existing, sheet];
      root.addEventListener("zl-input", this.handleAtomInput as EventListener);
      // Editing any control (or dismissing the alert) retires the current
      // step error. `zl-change` covers <zl-checkbox>/<zl-select>, which
      // don't emit `zl-input`; the clearing is imperative DOM surgery so
      // the rendered step string stays byte-identical and the subtree
      // (including any in-flight <zl-passkey>) is never rebuilt mid-edit.
      root.addEventListener("zl-change", this.handleAtomEdited as EventListener);
      root.addEventListener("zl-dismiss", this.handleAlertDismiss as EventListener);
      // <zl-button> dispatches `zl-submit` for both primary submits and
      // secondary actions; the orchestrator picks the right path based on
      // the button's `type` and `action`.
      root.addEventListener("zl-submit", this.handleAtomSubmit as EventListener);
      root.addEventListener("click", this.handleDelegatedAction as EventListener);
      // Native <form> submit fires on Enter inside any field and after the
      // browser's autofill / save-password handshake. Intercept it so we can
      // hand off to our flow-submit cycle without the page reloading.
      root.addEventListener("submit", this.handleFormSubmit as EventListener);
      // <zl-passkey> emits `zl-passkey-result` after a successful WebAuthn
      // ceremony. Auto-submit the proof so the user doesn't have to click
      // "Continue" — the ceremony IS the submission (ADR 013).
      root.addEventListener("zl-passkey-result", this.handlePasskeyResult as EventListener);
      // <zl-passkey> emits `zl-passkey-error` when the ceremony fails or is
      // cancelled. Surface the error on the current step.
      root.addEventListener("zl-passkey-error", this.handlePasskeyError as EventListener);
      // <zl-sso-providers> emits `zl-sso-select` when a provider button is
      // chosen. The answer is a non-terminal step carrying `redirect_url`,
      // which `applyResponse` follows on its way out.
      root.addEventListener("zl-sso-select", this.handleSsoSelect as EventListener);
    }
    return root;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (typeof window !== "undefined") {
      window.addEventListener("popstate", this.handlePopState);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (typeof window !== "undefined") {
      window.removeEventListener("popstate", this.handlePopState);
    }
  }

  /**
   * Start the flow after the first render rather than in `connectedCallback`.
   * Frameworks that wrap web components (e.g. `@lit/react` in the console)
   * attach the element first and then assign object properties (`branding`,
   * `locale`) via setters. `connectedCallback` runs synchronously on attach
   * — before any setters from a wrapper's effects/refs — so reading those
   * properties there sees stale defaults. `firstUpdated` runs after Lit's
   * first render, by which time setters from the wrapping framework have
   * fired.
   */
  protected override firstUpdated(): void {
    // Defer so `startFlow()` can set `loading` without scheduling a second
    // update before Lit finishes this commit (change-in-update warning).
    queueMicrotask(() => void this.startFlow());
  }

  /**
   * Resolves the effective locale dictionary. The built-in dictionary for the
   * resolved language is used as the base; entries from the `locales` map (if
   * set) are spread on top so partial overrides work without importing and
   * spreading the full base dictionary.
   *
   * Priority: explicit `lang` attr → `navigator.language` (user preference)
   * → `document.documentElement.lang` (page default) → English fallback.
   */
  private resolveLocale(): Locale {
    const code =
      this.lang ||
      (typeof navigator !== "undefined" ? navigator.language : "") ||
      (typeof document !== "undefined" ? document.documentElement.lang : "");
    const primary = (code.split("-")[0] ?? "").toLowerCase();
    const builtin = builtinLocales[primary] ?? en;
    const custom = this.locales?.[primary];
    if (!custom) return builtin;

    // Entries are Partial — merge key-by-key and skip explicit `undefined`
    // values, which a plain spread would let shadow the built-in copy.
    const merged: Locale = { ...builtin };
    for (const [key, value] of Object.entries(custom)) {
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (!this.engine || changed.has("locales") || changed.has("lang")) {
      this.engine = createLiquidEngine({ locale: this.resolveLocale() });
    }
    if (changed.has("previewState") && this.previewState && !this.preview) {
      console.warn(
        `[zitadel-login] preview-state="${this.previewState}" is not a preview state ` +
          `(${LOGIN_PREVIEW_STATES.join(", ")}); running the flow for real.`,
      );
    }
    const previewChanged =
      changed.has("previewState") || (changed.has("previewSuccessStep") && this.preview !== "");
    if (previewChanged && this.response) {
      // A flow already on screen becomes the base when preview is switched on
      // after mount; leaving preview restores it as it was served and lets
      // the flow run for real from there.
      this.previewBase ??= this.response;
      this.applyPreviewState();
      if (!this.preview) this.previewBase = null;
      // A preview holds no history entry; a flow resumed from one takes the
      // entry its step calls for.
      this.syncBackSentinel(this.preview ? null : this.response.step);
    }
    this.applySurfaceTheme(this.branding);
    this.setAttribute("aria-busy", this.loading ? "true" : "false");
  }

  override updated(changed: PropertyValues<this>): void {
    // Re-stamp part forwarding and widget-mode chrome on every commit:
    // `unsafeHTML` re-parses whenever the rendered string changes (step
    // swap, loading toggle, error dismiss), replacing previously stamped
    // nodes. The template's `zl-page-shell` sits in a different shadow
    // scope, so the variant reaches it as a stamped attribute, not a
    // `:host([variant])` selector.
    if (this.shadowRoot) {
      stampExportparts(this.shadowRoot);
      // A configured-but-dead logo_url/hero_url is invisible everywhere else
      // in the pipeline; this is the only layer that can see the image fail.
      armAssetFallbacks(this.shadowRoot);
      const widget = this.variant !== "page";
      for (const shell of this.shadowRoot.querySelectorAll("zl-page-shell")) {
        shell.toggleAttribute("data-widget", widget);
        // CSS-level so it also covers user-ejected templates: the rule in
        // layout-chrome.css hides `.zl-card-title`/`.zl-card-subtitle`
        // visually while keeping the step's accessible name.
        shell.toggleAttribute("data-suppress-header", this.suppressHeader);
      }
      // Stamped on the card too: its header REGION must leave the flex flow
      // (card-host.css) or the card keeps a blank 32px header band — the
      // slotted headings alone going sr-only doesn't collapse the region.
      for (const card of this.shadowRoot.querySelectorAll("zl-card")) {
        card.toggleAttribute("data-suppress-header", this.suppressHeader);
      }
    }
    const previousTheme = this.lastRenderedTheme;
    this.lastRenderedTheme = this.themeController.theme;

    const props = changed as Map<string, unknown>;
    if (props.has("response") && this.previewRepaint) {
      this.previewRepaint = false;
      // A preview state is not a step the visitor reached: keep focus where
      // the operator has it (the state selector) and put typed values back.
      // Not on the first paint, which focuses as any mount does.
      if (props.get("response") != null) {
        void this.restoreValuesAfterRender();
        return;
      }
    }
    if (props.has("response")) {
      // `changed` holds the OLD value: nullish (`null` initializer, or
      // undefined when the property never changed before) means this commit
      // applied the first response — the initial paint, not a user-driven
      // step swap.
      void this.hydrateStepAfterRender(props.get("response") == null);
      return;
    }
    if (previousTheme !== null && previousTheme !== this.lastRenderedTheme) {
      // A flip mid-step is not a step change: restore what was typed, but
      // leave focus where the visitor put it.
      void this.restoreValuesAfterRender();
    }
  }

  /**
   * Apply captured values and move focus once the new step has fully
   * rendered. This commit produces the step's field/action atoms, but those
   * render their own shadow DOM on a later microtask — so await this element's
   * update *and* the child atoms' first render before touching them, rather
   * than guessing a frame with `requestAnimationFrame`.
   *
   * Focus on the *initial* response is page-mode-only: a dedicated login
   * route should focus its first field, but a widget embedded further down
   * an arbitrary page must not steal focus and scroll-jump on load. Step
   * swaps are user-initiated, so focus moves in both modes.
   */
  private async hydrateStepAfterRender(initial = false): Promise<void> {
    await this.restoreValuesAfterRender();
    if (!initial || this.variant === "page") {
      this.moveFocusToFirstField(initial && this.variant === "page");
    }
  }

  /**
   * Put captured values back once the rebuilt subtree has rendered. Awaits the
   * child atoms' own first render before touching them, rather than guessing a
   * frame with `requestAnimationFrame`.
   */
  private async restoreValuesAfterRender(): Promise<void> {
    await this.updateComplete;
    const atoms = this.shadowRoot?.querySelectorAll<LitElement>(
      "zl-field, zl-select, zl-checkbox, zl-button",
    );
    if (atoms) {
      await Promise.all(Array.from(atoms).map((atom) => atom.updateComplete));
    }
    this.applyValuesToFields();
  }

  override render() {
    if (this.startupError) {
      // Same chrome a step renders into (page shell + card), because this is
      // still the login surface — just one that could not start. Without the
      // shell the alert lands bare in the top-left corner of an otherwise
      // empty page, which reads as a broken app rather than as auth reporting
      // a problem: the most common trigger is a misconfigured origin, where
      // the first step paints normally and only the submit fails.
      return html`<form class="zl-mount" novalidate>
        <zl-page-shell>
          <zl-card>
            <zl-alert severity="error">${this.startupError}</zl-alert>
          </zl-card>
        </zl-page-shell>
      </form>`;
    }
    // `completing` holds the loader through the terminal step: painting a
    // success screen the host immediately navigates away from shows the user
    // two confirmations for one sign-in.
    if (!this.response || !this.engine || this.completing) {
      return html`<slot name="loader"></slot>`;
    }
    const rendered = this.injectAttribution(this.renderStep(this.response.step, this.engine));
    return html`<form
      class="zl-mount"
      part="form"
      novalidate
      aria-busy=${this.loading ? "true" : "false"}
    >
      ${unsafeHTML(rendered)}
    </form>`;
  }

  /**
   * Inject the attribution badge into the rendered template's
   * `<zl-page-shell>` footer slot. The attribution must live INSIDE the
   * page-shell so it sits within the 100vh viewport rhythm (matching the
   * Figma sign-in frame where the pill sits 24px below the card, both
   * centred on the page). It can't be a sibling of the page-shell because
   * the page-shell already occupies the full viewport height.
   *
   * This markup is appended AFTER `renderStep` has sanitised the Liquid
   * output, so it is not run through DOMPurify. It is orchestrator-owned and
   * any tenant-supplied values (`custom_link`) are escaped via `escapeHtml`.
   */
  private injectAttribution(rendered: string): string {
    // A template that names where the trustmark goes wins over the footer slot.
    // The split designs use it to keep the mark with their form column: the
    // shell's footer spans both panes, so it would otherwise sit 24px below the
    // *row*, and the row is as tall as the brand pane rather than the card.
    // `ALLOW_DATA_ATTR` keeps the anchor through the sanitiser, which may have
    // normalised it to `data-zl-attribution-anchor=""`.
    const anchor = /<div\s+data-zl-attribution-anchor(?:="")?\s*>\s*<\/div>/;
    if (anchor.test(rendered)) {
      // Suppressed attribution replaces the anchor with nothing, so the form
      // column does not keep a 24px gap below an element that renders empty.
      return rendered.replace(anchor, this.renderAttributionHtml("inline"));
    }
    const html = this.renderAttributionHtml("footer");
    if (!html) return rendered;
    if (rendered.includes("</zl-page-shell>")) {
      return rendered.replace("</zl-page-shell>", `${html}</zl-page-shell>`);
    }
    return rendered + html;
  }

  /**
   * The branding a template renders against, with `logo_url` already resolved
   * to the mark for the active side. Templates read one logo field and get the
   * right file per surface; the per-side URLs stay on `theme` for a template
   * that wants to reach them itself.
   */
  private brandingForTemplate(): Branding | Record<string, never> {
    if (!this.branding) {
      return {};
    }
    const logoUrl = resolveLogoUrl(this.branding, this.themeController.theme);
    return { ...this.branding, logo_url: logoUrl };
  }

  /**
   * "Secured with Zitadel" attribution chrome injected into every
   * template's page-shell footer slot. Reads `branding.attribution`, which
   * the wire contract does not carry, so the mark always renders.
   */
  private renderAttributionHtml(placement: "footer" | "inline" = "footer"): string {
    const attribution = this.branding?.attribution;
    const show = attribution?.show_zitadel !== false;
    const custom = attribution?.custom_link;
    if (!show && !custom) {
      return "";
    }
    // The design sets the trustmark as plain text beside the logotype rather
    // than inside a chip, and draws a badge beside it. The widget does not
    // render that badge: nothing on the flow response carries a duration to
    // put in it, and an invented one would be worse than none. It exposes the
    // position instead — the `attribution-trailing` slot — so a host that does
    // have something true to say there can say it. The console's claim page is
    // the first: it knows how long the project can still be claimed.
    //
    // A `<slot>` is `display: contents` by default, so an unfilled one is not
    // a flex item and contributes no gap. Every existing embed renders exactly
    // as it did.
    const mark = custom
      ? `<a class="zl-trustmark__mark" part="attribution-mark" href="${escapeHtml(
          String(custom.href),
        )}">${escapeHtml(String(custom.label))}</a>`
      : `<a class="zl-trustmark__mark" part="attribution-mark" href="https://zitadel.com" aria-label="Secured with Zitadel">${zitadelTrustmarkInnerHtml()}</a>`;
    const slot = placement === "footer" ? ` slot="footer"` : "";
    return `<div${slot} part="attribution" class="zl-attribution zl-trustmark">${mark}<slot name="attribution-trailing"></slot></div>`;
  }

  /** Declarative config read from this element's attributes. */
  private get projectAttrs(): ProjectAttrs {
    return { projectId: this.projectId, proxyPath: this.proxyPath, url: this.url };
  }

  private async startFlow(): Promise<void> {
    this.loading = true;
    this.startupError = null;
    try {
      // Resolve inside the try so a missing configuration surfaces through
      // `handleTransportError` (rendered as `startupError`) rather than as an
      // unhandled promise rejection from `firstUpdated`'s microtask.
      const { project: cfg, api } = resolveApi(this.project, this.projectAttrs, "<zitadel-login>");
      let wire: CreateFlow201 | undefined;
      const resumeId = this.resumeFlowId || flowIdFromLocation();
      if (resumeId) {
        try {
          wire = await getCurrentStep(api, resumeId);
        } catch (error) {
          // A handle can outlive its flow: the cookie window closed during
          // the external sign-in, so the browser no longer sends the
          // required cookie (400), the cookie names another flow (404), or
          // the flow finished in another tab (410). This is still the
          // sign-in page, and a startup error would leave it with no way
          // forward, so start over. Logged so a host passing a wrong handle
          // does not get a silent restart.
          const gone =
            error instanceof ApiError &&
            (error.status === 400 || error.status === 404 || error.status === 410);
          if (!gone) throw error;
          console.warn(`[zitadel-login] flow ${resumeId} no longer resolves; starting a new flow.`);
        }
      }
      if (!wire) {
        if (!cfg.projectId) {
          throw new Error(
            "<zitadel-login> requires a project id (the `project-id` attribute, " +
              "`configureZitadel({ projectId })`, or a `project` handle) to start a flow.",
          );
        }
        wire = await apiStartFlow(api, {
          project_id: cfg.projectId,
          purpose: this.purpose,
          ...(this.flowName ? { flow_definition_name: this.flowName } : {}),
        });
      }
      this.applyResponse(wire);
      // Symmetric with `submit()`: every applied step announces itself, the
      // first one included. A host app driving its own chrome from the step
      // (progress, headings, analytics) would otherwise see nothing until
      // after the visitor's first submit.
      emit(this, "zitadel-flow-step", { step: wire.step });
    } catch (error) {
      this.handleTransportError(this.describeFlowSelectionError(error));
    } finally {
      this.loading = false;
    }
    // After `loading` has settled: the `loading` preview holds it back up.
    if (this.preview) this.applyPreviewState();
  }

  /**
   * Derive the shown step from {@link previewBase} for {@link previewState}.
   * Sets `response` directly, as a passkey error does, rather than through
   * `applyResponse`: nothing here is a new server step, so history and
   * completion must not react to it.
   */
  private applyPreviewState(): void {
    const base = this.previewBase;
    if (!base) return;
    const state = this.preview;
    this.stepErrorDismissed = false;
    this.loading = state === "loading";
    const next = previewResponse(base, state, this.previewSuccessStep || "done");
    // Same object for `default` right after the start: no repaint to flag,
    // and the initial paint keeps its own focus rule.
    if (next === this.response) return;
    this.previewRepaint = true;
    this.response = next;
  }

  /**
   * When a `flow-name` lookup fails, the server's envelope only says
   * "not found" / "purpose mismatch" — it cannot know the name came from
   * an attribute. Rewrap those two codes with the attribute and the fix;
   * every other error passes through untouched.
   */
  private describeFlowSelectionError(error: unknown): unknown {
    if (!this.flowName || !(error instanceof ApiError)) return error;
    const code =
      typeof error.body === "object" && error.body !== null && "code" in error.body
        ? String((error.body as { code: unknown }).code)
        : "";
    if (code === "flowdef.not_found") {
      return new Error(
        `<zitadel-login> flow-name="${this.flowName}" does not match any active flow ` +
          `definition in this project. Check the \`name\` in your flow file and that ` +
          `it has been applied (\`zitadel apply\`).`,
      );
    }
    if (code === "flowdef.purpose_mismatch") {
      return new Error(
        `<zitadel-login> flow-name="${this.flowName}" matched a flow definition that ` +
          `does not serve purpose "${this.purpose}".`,
      );
    }
    return error;
  }

  private applyResponse(wire: CreateFlow201): void {
    // A fresh response carries fresh (or no) errors — un-dismiss.
    this.stepErrorDismissed = false;
    const preview = this.preview !== "";
    // Decided before the step is assigned: `maybeCompleteFlow` navigates a
    // turn later, and by then the terminal screen has already painted. A
    // preview navigates nowhere, so it never holds the loader for it.
    this.completing = !preview && navigatesOnComplete(wire, this.postSignInUrl);
    this.response = wire;
    const { branding, issues } = validateBranding(wire.branding, {
      renderingOrigin: this.ownerDocument.location.origin,
    });
    this.branding = branding;
    this.themeController.setBranding(branding);
    if (issues.length > 0) {
      console.warn("[zitadel-login] branding payload has issues:", issues);
    }
    // Defaults seed every declared field; existing entries (typed input,
    // carry-over from prior steps) win on conflict.
    this.formValues = { ...collectInitialValues(wire.step), ...this.formValues };

    // A preview never leaves the step it shows: it takes no history entry,
    // makes no trip to a provider, exchanges no handoff and tells no host the
    // visitor signed in. The served step becomes what its states derive from.
    if (preview) {
      this.previewBase = wire;
      return;
    }

    this.syncBackSentinel(wire.step);

    if (this.maybeRedirectToProvider(wire)) return;
    void this.maybeCompleteFlow(wire);
  }

  /**
   * History API (ADR 022): keep exactly one same-document entry — the
   * sentinel — on the stack while the current step supports
   * back-navigation, so the browser's back gesture fires `popstate`
   * (handled in `onPopState`) instead of leaving the page. Arming only
   * on the unarmed → armed transition means consecutive back-capable
   * steps (and re-renders of the same step, e.g. after a failed submit)
   * never grow the stack. Steps without a `kind: "back"` action retire
   * the sentinel — the next back press then navigates the host page
   * (leaves the flow), which is correct.
   *
   * `null` is a step with nothing to go back from: a preview, which takes no
   * entry and gives back one the flow took before it was switched on.
   */
  private syncBackSentinel(step: CreateFlow201Step | null): void {
    if (typeof window === "undefined") return;
    const hasBack = Boolean(step?.actions?.some((a) => a.kind === "back"));
    if (hasBack && !this.armed) {
      // Spread the host's state: vue-router (Nuxt) keeps `position` /
      // `back` / `forward` here and reads them on popstate. Replacing it
      // wholesale leaves the sentinel opaque to the host router.
      history.pushState({ ...history.state, zl: true }, "");
      this.armed = true;
    } else if (!hasBack && this.armed) {
      this.armed = false;
      // Only traverse while we still own the current entry. If the host
      // pushed its own entry after we armed, `history.back()` would pop
      // *that* one and trigger a host back-navigation the user never
      // asked for. Leaving a stale sentinel behind is the lesser evil —
      // same tradeoff as disconnect; the popstate handler skips stale
      // sentinels in one extra hop from either direction.
      if ((history.state as { zl?: boolean } | null)?.zl === true) {
        if (this.completing) {
          // A terminal step that navigates away: retire the sentinel in
          // place instead of traversing. `history.back()` fires `popstate`
          // in the host, and a host router that reloads on popstate would
          // re-read the session `maybeCompleteFlow` is about to establish
          // and act on it in a document that is already being replaced —
          // the console claim page spent its single-use challenge that way,
          // once here and once in the document it navigated to. The
          // retired entry stays on the stack under the destination (a
          // same-URL destination, like the claim page, replaces it); a back
          // press from there lands on the host page signed in, which is the
          // same stale-sentinel tradeoff as above, one hop at most.
          history.replaceState({ ...history.state, zl: false }, "");
        } else {
          this.ignoreNextPop = true;
          history.back();
        }
      }
    }
  }

  /**
   * Hand the browser to an identity provider.
   *
   * `step.redirect_url` is the engine's answer to `action: "sso"`: a full-page
   * navigation to the provider's authorization endpoint, which is the only way
   * the user can authenticate there. It is not a completion — the flow resumes
   * when the provider returns to the callback — so it is deliberately separate
   * from {@link maybeCompleteFlow} and emits its own event rather than
   * `zitadel-flow-complete`, which hosts treat as "signed in".
   *
   * Returns whether it navigated, so the caller can stop.
   */
  private maybeRedirectToProvider(response: CreateFlow201): boolean {
    const target = response.step.redirect_url;
    // A terminal step carries `redirect_url` too — the engine copies the
    // relying party's `redirect_uri` onto it when a sign-in completes
    // (`terminate()` in flow_state_machine.go). That is a finished sign-in,
    // not a trip to a provider, and it belongs to `maybeCompleteFlow`.
    if (!target || response.step.complete) return false;
    emit(this, "zitadel-flow-redirect", { redirect_url: target, step: response.step });
    if (typeof window === "undefined") return false;
    window.location.assign(target);
    return true;
  }

  /**
   * Acts on terminal flow steps. The wire surfaces two kinds of completion:
   *
   * - `step.complete === "redirect"` — navigate the browser to
   *   `response.redirect_uri` (OIDC/SAML `auth_request_id` resolved). This
   *   takes precedence over `post-sign-in-url`.
   * - `step.complete === "show"` — when `post-sign-in-url` is set, exchange
   *   the `handoff_token` for a session cookie and navigate there.
   *
   * `zitadel-flow-complete` is always emitted so hosts with custom post-sign-in
   * flows can handle the handoff themselves when `post-sign-in-url` is omitted.
   */
  private async maybeCompleteFlow(response: CreateFlow201): Promise<void> {
    const behavior = response.step.complete;
    if (!behavior) return;

    emit(this, "zitadel-flow-complete", {
      behavior,
      redirect_uri: response.redirect_uri,
      handoff_token: response.handoff_token,
      handoff_token_expires_at: response.handoff_token_expires_at,
    });

    if (typeof window === "undefined") return;
    if (behavior === "redirect" && response.redirect_uri) {
      window.location.assign(response.redirect_uri);
      return;
    }

    const handoffToken = response.handoff_token;
    if (behavior === "show" && handoffToken && this.postSignInUrl) {
      this.loading = true;
      try {
        const { project: cfg, api } = resolveApi(
          this.project,
          this.projectAttrs,
          "<zitadel-login>",
        );
        await exchangeSession(api, { handoff_token: handoffToken }, { project_id: cfg.projectId });
        window.location.assign(this.postSignInUrl);
      } catch (error) {
        this.handleTransportError(error);
      } finally {
        this.loading = false;
      }
    }
  }

  private renderStep(step: CreateFlow201Step, engine: Liquid): string {
    const tenantSource =
      typeof this.branding?.liquid_template === "string" && this.branding.liquid_template.length > 0
        ? this.branding.liquid_template
        : null;

    // `error.*` keys — the server's validation dialect
    // (`error.<field>_<rule>`, one key per violation, "; "-joined) —
    // localise via the catalog with generic per-rule fallbacks; anything
    // else (outcome names, diagnostics) stays verbatim.
    const rawErrors: FlowError[] = step.error
      ? (parseSsoError(step.error) ??
        localiseFlowErrorKeys(step.error, {
          locale: this.resolveLocale(),
          stepName: step.name ?? "",
          // Inline-routed keys downgrade to a banner message when the
          // step doesn't render their field — the inline outlet is the
          // only place the template shows them.
          fields: (step.fields ?? []).map((field) => field.name),
        }) ?? [{ message: step.error }])
      : [];
    // A dismissed step error must not flicker back on the `loading`
    // re-render (the only step re-render while the user stays on this
    // step — it rebuilds the subtree anyway). While idle the array must
    // stay as-is: keystroke re-renders have to produce a byte-identical
    // string, and the imperatively removed alert stays removed.
    const errors: FlowError[] = this.loading && this.stepErrorDismissed ? [] : rawErrors;

    const fields = step.fields ?? [];
    const actions = step.actions ?? [];
    const context: LiquidContext = {
      step: {
        name: step.name,
        complete: step.complete,
        texts: step.texts ?? {},
      },
      fields,
      actions,
      gates: step.gates ?? {},
      sso_providers: step.sso_providers ?? [],
      // While submitting a passkey proof, `loading` re-renders the current
      // step before the server returns. Re-rendering the same challenge would
      // reconnect `<zl-passkey>` and start a second WebAuthn ceremony. A
      // preview renders none at all: the atom starts its ceremony on connect.
      challenge: this.loading || this.preview ? null : (step.challenge ?? null),
      messages: [],
      identity: this.deriveIdentity(),
      errors,
      branding: this.brandingForTemplate(),
      loading: this.loading,
    };

    let raw: string;
    try {
      if (tenantSource) {
        const compiled =
          this.tenantTemplateCache?.source === tenantSource
            ? this.tenantTemplateCache.template
            : engine.parse(tenantSource);
        this.tenantTemplateCache = { source: tenantSource, template: compiled };
        raw = engine.renderSync(compiled, context);
      } else {
        raw = engine.renderFileSync(TEMPLATE_NAMES.default, context);
      }
    } catch (error) {
      console.error("[zitadel-login] Liquid render failed:", error);
      try {
        raw = engine.renderFileSync(TEMPLATE_NAMES.default, context);
      } catch {
        return `<zl-alert severity="error">We couldn't render this step.</zl-alert>`;
      }
    }

    const patched = patchMandatoryGates(raw, step, this.resolveLocale());
    return this.sanitise(patched);
  }

  /**
   * Build a `FlowIdentity` from the orchestrator's captured form values so
   * the signed-in template can greet the user by email without the API
   * having to round-trip identity claims. Email comes from the
   * identifier step; display name composes from `given_name` /
   * `family_name` when the register step ran.
   */
  private deriveIdentity(): FlowIdentity | null {
    const email = this.formValues.email?.trim();
    const given = this.formValues.given_name?.trim();
    const family = this.formValues.family_name?.trim();
    const display = [given, family].filter(Boolean).join(" ").trim();
    if (!email && !display) return null;
    return {
      ...(email ? { email_address: email } : {}),
      ...(display ? { display_name: display } : email ? { display_name: email } : {}),
    };
  }

  /** All rendered input atoms exposing the `formValue` contract. */
  private fieldAtoms(): FieldAtom[] {
    const root = this.shadowRoot;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>("[name]")).filter(isFieldAtom);
  }

  private applyValuesToFields(): void {
    for (const atom of this.fieldAtoms()) {
      const name = atom.getAttribute("name");
      if (!name) continue;
      const next = this.formValues[name];
      if (next !== undefined && atom.formValue !== next) {
        atom.formValue = next;
      }
    }
  }

  /**
   * Names of the current step's `required` fields whose captured value is
   * empty. Reads each atom's live `formValue` (the getter reflects the native
   * control, so autofill that skipped `input` events is still seen), so this
   * is browser-independent and does not rely on native constraint validation.
   */
  private missingRequiredFields(): string[] {
    const values = new Map<string, string>();
    for (const atom of this.fieldAtoms()) {
      const name = atom.getAttribute("name");
      if (name) values.set(name, atom.formValue);
    }
    return this.response
      ? requiredFieldNames(this.response.step).filter((name) => (values.get(name) ?? "") === "")
      : [];
  }

  /**
   * Surface a client-side required-field error using the server's own
   * validation dialect (`error.<field>_required`, "; "-joined), so it flows
   * through the same localisation and inline/banner routing as a real
   * backend rejection — no native browser bubble. Idempotent: re-running with
   * the same keys (both submit entry points fire on one click) is a no-op.
   */
  private reportRequiredErrors(fields: readonly string[]): void {
    if (!this.response) return;
    const errorKey = fields.map((name) => `error.${name}_required`).join("; ");
    if (this.response.step.error === errorKey) return;
    this.stepErrorDismissed = false;
    this.response = {
      ...this.response,
      step: { ...this.response.step, error: errorKey },
    };
  }

  /**
   * Snapshot the current step's field values straight from the rendered input
   * atoms through their uniform `formValue` contract. Tag-agnostic: every
   * form-participating atom is read the same way, so a new field type needs no
   * change here. Declared fields default to "" so the backend still runs its
   * required-checks and challenge dispatch instead of silently advancing on a
   * field-less payload. Captured values are folded into `formValues` for
   * cross-step identity (the signed-in greeting) and post-error restoration.
   */
  private collectSubmitFields(): SubmitFlowStepBodyFields {
    const current = new Map<string, string>();
    for (const atom of this.fieldAtoms()) {
      const name = atom.getAttribute("name");
      if (name) current.set(name, atom.formValue);
    }
    if (current.size > 0) {
      this.formValues = { ...this.formValues, ...Object.fromEntries(current) };
    }
    const fields: SubmitFlowStepBodyFields = {};
    for (const f of this.response?.step.fields ?? []) {
      const value = current.get(f.name) ?? "";
      // A `checkbox` maps to a JSON `boolean` schema property. The atom carries
      // its value token when checked and "" when unchecked (native-checkbox
      // semantics), but the server validates the property as a real boolean and
      // rejects a string, so submit `true`/`false` rather than the token.
      if (f.type === "checkbox") {
        fields[f.name] = value !== "";
        continue;
      }
      // A `select` renders a closed `enum`. Its leading placeholder option
      // submits "" when the user picks nothing, but "" is not a member of the
      // enum, so sending it fails the server's enum validation (e.g.
      // create_user rejects with "no enum value matched"). Omit the field
      // unless the value is an actual enum member the schema allows — which
      // includes "" only when the schema explicitly lists it, so an
      // intentionally-allowed empty option is still sent. An omitted required
      // select still fails the server's required-check, surfacing a clearer
      // "required" error instead of an enum mismatch. Other fields keep the ""
      // default so required-checks and challenge dispatch still run.
      if (f.type === "select" && !isAllowedSelectValue(f, value)) continue;
      fields[f.name] = value;
    }
    return fields;
  }

  /**
   * True once the user retired the current step error by editing a field or
   * dismissing the alert. Deliberately NON-reactive: consulting reactive
   * state in `renderStep` would change its output string on the first
   * post-dismiss keystroke, and `unsafeHTML` would rebuild the whole step
   * subtree — wiping typed values (`hydrateStepAfterRender` only re-applies
   * them on response changes) and reconnecting atoms. Reset on every new
   * response; consulted only by the `loading` re-render, which rebuilds
   * anyway.
   */
  private stepErrorDismissed = false;

  private handleAtomInput = (event: CustomEvent<{ name: string; value: string }>): void => {
    if (!event.detail) return;
    const { name, value } = event.detail;
    if (!name) return;
    this.formValues = { ...this.formValues, [name]: value };
    this.syncFieldElementValue(name, value);
    this.clearStaleErrors(name);
    emit(this, "zitadel-flow-input", { name, value });
  };

  /**
   * `zl-change` from <zl-checkbox>/<zl-select>. Persist the atom's value into
   * `formValues` — mirroring `handleAtomInput` for text fields — so a later
   * step re-render (a validation error re-parses the template via `unsafeHTML`
   * and rebuilds the atoms) restores the selection/checked state through
   * `applyValuesToFields` instead of dropping back to the template default.
   * Reads the live `formValue` off the atom rather than the event's `value`
   * token, because an unchecked checkbox reports "" there but keeps its token
   * in the detail. Also clears stale errors on the edited field.
   */
  private handleAtomEdited = (event: CustomEvent<{ name?: string }>): void => {
    const name = event.detail?.name;
    if (!name) return;
    const atom = event.target;
    if (atom instanceof HTMLElement && isFieldAtom(atom)) {
      this.formValues = { ...this.formValues, [name]: atom.formValue };
    }
    this.clearStaleErrors(name);
  };

  /** Explicit dismiss of the step-error alert (it removes itself). */
  private handleAlertDismiss = (event: Event): void => {
    const target = event.target as Element | null;
    if (target?.matches?.("zl-alert[data-zl-step-error]")) {
      this.stepErrorDismissed = true;
    }
  };

  /**
   * Retire the current step error after the user edits `fieldName`:
   * remove the form-level alert(s) and clear the edited field's inline
   * error — other fields' inline errors stay until they are edited.
   * Imperative on purpose; see {@link stepErrorDismissed}.
   */
  private clearStaleErrors(fieldName: string): void {
    if (!this.response?.step.error) return;
    const root = this.shadowRoot;
    if (!root) return;
    if (!this.stepErrorDismissed) {
      this.stepErrorDismissed = true;
      for (const alert of root.querySelectorAll("zl-alert[data-zl-step-error]")) {
        alert.remove();
      }
    }
    // Schema field names are free-form (dots, quotes, `x-…#…`), so match by
    // attribute value instead of interpolating into a CSS selector.
    for (const field of root.querySelectorAll<HTMLElement & { invalid?: boolean; error?: string }>(
      "zl-field",
    )) {
      if (field.getAttribute("name") !== fieldName || !field.invalid) continue;
      field.invalid = false;
      field.error = "";
    }
  }

  /** Mirror a value onto the matching rendered atom (used after atom events). */
  private syncFieldElementValue(name: string, value: string): void {
    for (const atom of this.fieldAtoms()) {
      if (atom.getAttribute("name") === name && atom.formValue !== value) {
        atom.formValue = value;
      }
    }
  }

  private handleAtomSubmit = (event: CustomEvent<{ action: string | null }>): void => {
    if (this.loading) return;
    void this.submit(event.detail?.action ?? null);
  };

  /**
   * A provider was chosen. `sso` is the reserved action the flow contract
   * defines for this, carrying the connection id the button reported.
   *
   * Nothing is released afterwards: submitting re-renders the step, which
   * replaces the provider atom outright, and a failed submit re-renders it
   * again with `loading` back to false — so the buttons come back enabled on
   * their own.
   */
  private handleSsoSelect = (event: CustomEvent<{ providerId?: string }>): void => {
    const providerId = event.detail?.providerId;
    if (this.loading || !providerId) return;
    void this.submit(SSO_ACTION, undefined, providerId);
  };

  /** Secondary navigation rows (`data-action` on `.zl-card-nav__link`). */
  private handleDelegatedAction = (event: Event): void => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
    if (!target || target.closest("zl-button") || this.loading) return;
    const action = target.getAttribute("data-action");
    if (!action) return;
    event.preventDefault();
    void this.submit(action);
  };

  private handleFormSubmit = (event: SubmitEvent): void => {
    // Always intercept: we own the submit cycle. Without this the page would
    // navigate to whatever `action` URL the form has (none) and lose state.
    event.preventDefault();
    // Before the required-field gate: a preview shows the state it was asked
    // for, not the one Enter would produce.
    if (this.loading || this.preview) return;
    // This is the sole submit path for the primary action (submit-type
    // <zl-button> and Enter both drive `form.requestSubmit()`; the button no
    // longer emits a parallel `zl-submit`). Enforce the step's required fields
    // here and surface a styled, localised error instead of submitting an
    // empty required value for the server to reject. Secondary actions (back,
    // skip, passkey…) arrive via `zl-submit` → `handleAtomSubmit`, so they are
    // never gated.
    const missing = this.missingRequiredFields();
    if (missing.length > 0) {
      this.reportRequiredErrors(missing);
      return;
    }
    // `submitter` is the button that triggered the submit. When the user
    // pressed Enter inside a `<zl-field>`, the field calls
    // `form.requestSubmit()` with no submitter, so we fall back to the first
    // primary `<zl-button>`'s action (the step's primary action).
    const submitter = event.submitter as HTMLElement | null;
    const explicit = submitter?.getAttribute?.("action") ?? null;
    const action = explicit ?? this.findPrimaryAction();
    void this.submit(action);
  };

  /**
   * Handle a successful WebAuthn ceremony. Auto-submit with the proof
   * as `challenge_response` so the flow advances without extra user
   * interaction — the ceremony IS the factor verification (ADR 013).
   */
  private handlePasskeyResult = (
    event: CustomEvent<{ challenge_id: string; method: string; proof: Record<string, unknown> }>,
  ): void => {
    if (this.loading) return;
    const { challenge_id, method, proof } = event.detail;
    void this.submit(method, {
      challenge_id,
      method,
      proof,
    });
  };

  /**
   * Handle a WebAuthn ceremony error. Re-render the current step with
   * an error message so the user sees feedback and can retry or skip.
   *
   * Guard: if the step already carries the same error key, skip the update.
   * Mutating `this.response` triggers `unsafeHTML` to replace the DOM tree,
   * which reconnects a fresh `<zl-passkey>` that immediately re-starts the
   * ceremony — creating an infinite loop. The guard breaks the cycle.
   *
   * We also strip the `challenge` from the step so the template does not
   * render a new `<zl-passkey>` on re-render. Without this, the first
   * cancel would trigger a second ceremony (the guard prevents a third).
   */
  private handlePasskeyError = (
    event: CustomEvent<{
      challenge_id: string;
      error: string;
      aborted: boolean;
      timed_out?: boolean;
    }>,
  ): void => {
    if (!this.response) return;
    const { error: message, aborted, timed_out: timedOut } = event.detail;
    const errorKey = timedOut
      ? "error.passkey_timeout"
      : aborted
        ? "error.passkey_cancelled"
        : "error.passkey_failed";
    if (this.response.step.error === errorKey) return;
    // This path replaces the response without going through applyResponse;
    // the fresh error must not start life dismissed.
    this.stepErrorDismissed = false;
    const stepWithoutChallenge = { ...this.response.step };
    delete stepWithoutChallenge.challenge;
    this.response = {
      ...this.response,
      step: { ...stepWithoutChallenge, error: errorKey },
    };
    console.warn(
      `[zitadel-login] passkey ceremony ${timedOut ? "timed out" : aborted ? "cancelled" : "failed"}: ${message}`,
    );
  };

  private findPrimaryAction(): string | null {
    const root = this.shadowRoot;
    if (!root) return null;
    const primary =
      root.querySelector('zl-button[hierarchy="primary"][type="submit"]') ??
      root.querySelector('zl-button[hierarchy="primary"]');
    return primary?.getAttribute("action") || null;
  }

  /**
   * On the initial paint, only a field earns focus: script-moved focus with
   * no prior interaction matches `:focus-visible`, so autofocusing a button
   * on a field-less step (passkey-first) paints a ring that reads as a
   * pre-selected state. Step swaps keep button focus — there the browser
   * derives the modality from the user's actual input.
   */
  private moveFocusToFirstField(fieldsOnly = false): void {
    const root = this.shadowRoot;
    if (!root) return;
    const focusables = fieldsOnly
      ? this.fieldAtoms()
      : Array.from(
          root.querySelectorAll<HTMLElement>("zl-field, zl-select, zl-checkbox, zl-button"),
        );
    const target = focusables.find(
      (el) =>
        !el.hasAttribute("disabled") &&
        !el.hasAttribute("hidden") &&
        el.getAttribute("type") !== "hidden",
    );
    target?.focus();
  }

  private async submit(
    action: string | null,
    challengeResponse?: SubmitFlowStepBodyChallengeResponse,
    ssoProviderId?: string,
  ): Promise<void> {
    // Every other entry point (actions, back, passkey proofs) lands here, so
    // this one check keeps a preview from ever writing to the flow.
    if (!this.response || this.loading || this.preview) return;
    const { id, session_token } = this.response;
    this.loading = true;
    try {
      // Only send field values the current step defines. `formValues` carries
      // state across steps (e.g. email for the signed-in greeting), but
      // collectSubmitFields keys off the step's declared fields, so a step
      // without fields yields an empty map and never leaks prior values.
      const fields = this.collectSubmitFields();
      const body: SubmitFlowStepBody = {
        session_token,
        action: action ?? "submit",
        fields,
        ...(challengeResponse ? { challenge_response: challengeResponse } : {}),
        // The page the callback brings the browser back to; the engine
        // refuses a target on another origin.
        ...(ssoProviderId
          ? { sso_provider_id: ssoProviderId, return_target: returnTargetFor(id) }
          : {}),
      };
      const { api } = resolveApi(this.project, this.projectAttrs, "<zitadel-login>");
      const wire = await apiSubmitStep(api, id, body);
      this.applyResponse(wire);
      emit(this, "zitadel-flow-step", { step: wire.step });
    } catch (error) {
      this.handleTransportError(error);
    } finally {
      this.loading = false;
    }
    // Preview switched on while this submit was in flight: show the step it
    // landed on in the chosen state.
    if (this.preview) this.applyPreviewState();
  }

  /**
   * Handle the browser's back/forward gesture (ADR 022). When `popstate`
   * fires:
   *
   * - **Self-initiated** (`ignoreNextPop`) → `applyResponse` is retiring
   *   the sentinel; ignore.
   * - **Back press while armed** → the browser consumed the sentinel.
   *   Re-arm it immediately — so the stack shape is identical on every
   *   step and repeated presses behave the same at any flow depth — then
   *   submit the step's `kind: "back"` action.
   * - **Landing on the sentinel while armed** → the host page pushed an
   *   entry above the sentinel (e.g. an in-page `#anchor` click) and the
   *   user backed out of it. They are back where the widget expects them
   *   — not asking the flow to go back; do nothing.
   * - **Forward press onto a retired sentinel** (it survives as a forward
   *   entry after `history.back()`) → bounce back: flow state is
   *   server-authoritative, the browser cannot skip ahead
   *   (ADR 022 §Edge cases).
   * - Anything else is host-page traversal — leave the browser alone.
   */
  private onPopState(event: PopStateEvent): void {
    if (this.ignoreNextPop) {
      this.ignoreNextPop = false;
      return;
    }

    if (this.armed) {
      if ((event.state as { zl?: boolean } | null)?.zl === true) {
        // Traversal landed ON the sentinel from an entry above it that the
        // host page created after we armed. Position is as expected; the
        // gesture was aimed at the host entry, not the flow.
        return;
      }
      // Back press: the browser popped the sentinel.
      this.armed = false;
      const backAction = this.response?.step?.actions?.find((a) => a.kind === "back");
      if (backAction) {
        history.pushState({ zl: true }, "");
        this.armed = true;
        void this.submit(backAction.name);
      }
      return;
    }

    if ((event.state as { zl?: boolean } | null)?.zl === true) {
      this.ignoreNextPop = true;
      history.back();
    }
  }

  private handleTransportError(error: unknown): void {
    // For API rejections, prefer the server's error-envelope message (e.g.
    // which origins a project allows) over the generic "POST … returned N".
    const message =
      error instanceof ApiError
        ? apiErrorMessage(error)
        : error instanceof Error
          ? error.message
          : "Unexpected error contacting the Flow API.";
    this.startupError = message;
    console.error("[zitadel-login]", error);
    emit(this, "zitadel-flow-error", { message });
  }
}

/**
 * Whether `value` is a member of a select field's closed `enum`. A select
 * with no explicit enum has no submittable value, so this returns `false`
 * and the caller omits the field. Because the enum never contains "" unless
 * the schema deliberately lists it, an untouched placeholder ("") is omitted
 * rather than sent and rejected by the server's enum validation.
 */
function isAllowedSelectValue(field: CreateFlow201StepFieldsItem, value: string): boolean {
  return field.validation?.enum?.includes(value) ?? false;
}

/** Every state {@link ZitadelLogin.previewState} can show a step in, in order. */
export const LOGIN_PREVIEW_STATES = [
  "default",
  "validation_error",
  "submission_error",
  "loading",
  "success",
] as const;
export type LoginPreviewState = (typeof LOGIN_PREVIEW_STATES)[number];

/**
 * The states that show `step` differently from `default`, for a surface that
 * offers them. `validation_error` needs a required field to flag; a step
 * without one renders it as `default`.
 */
export function loginPreviewStatesFor(step: CreateFlow201Step): LoginPreviewState[] {
  const flaggable = requiredFieldNames(step).length > 0;
  return LOGIN_PREVIEW_STATES.filter((state) => state !== "validation_error" || flaggable);
}

/** The response {@link ZitadelLogin.previewState} shows for the served one. */
function previewResponse(
  base: CreateFlow201,
  state: LoginPreviewState | "",
  successStep: string,
): CreateFlow201 {
  if (state === "" || state === "default" || state === "loading") return base;
  if (state === "success") {
    // The terminal step carries no fields or actions, so its name is all a
    // client-side stand-in needs: the texts follow the server's
    // `<step>.title` / `<step>.description` convention.
    return {
      ...base,
      step: {
        name: successStep,
        texts: {
          title_key: `${successStep}.title`,
          description_key: `${successStep}.description`,
        },
        complete: "show",
        fields: [],
        actions: [],
        gates: {},
      },
    };
  }
  // Step errors in the dialect the template already routes:
  // `error.<field>_required` per required field (what the server answers an
  // empty submit with), or the catalog's form-level failure, which paints the
  // banner.
  const error =
    state === "validation_error"
      ? requiredFieldNames(base.step)
          .map((name) => `error.${name}_required`)
          .join("; ")
      : "error.sign_in_server";
  return { ...base, step: { ...base.step, error } };
}

/**
 * Names of the step's `required` fields. A checkbox always submits a real
 * boolean (`false` when unticked), so it is never required in this sense; a
 * must-accept boolean is enforced by the schema (`const: true`), not here.
 */
function requiredFieldNames(step: CreateFlow201Step): string[] {
  return (step.fields ?? [])
    .filter((field) => field.type !== "checkbox" && field.required)
    .map((field) => field.name);
}

/**
 * Whether a terminal step ends in a navigation rather than a screen: a
 * `redirect` with a URI, or a `show` whose handoff the widget exchanges before
 * sending the browser to `post-sign-in-url`. A `show` without a
 * `post-sign-in-url` is the host handling the handoff itself, and that screen
 * is the flow's own last word — it still renders.
 */
function navigatesOnComplete(wire: CreateFlow201, postSignInUrl: string | undefined): boolean {
  // A non-terminal step carrying `redirect_url` hands the browser to an
  // identity provider mid-flow — the flow is not finished, but this document
  // is leaving, so the step must not paint either.
  if (wire.step.redirect_url && !wire.step.complete) return true;
  const behavior = wire.step.complete;
  if (behavior === "redirect") return Boolean(wire.redirect_uri);
  if (behavior === "show") return Boolean(wire.handoff_token && postSignInUrl);
  return false;
}

function collectInitialValues(step: CreateFlow201Step): Record<string, string> {
  const values: Record<string, string> = {};
  if (!step.fields) return values;
  for (const field of step.fields) {
    values[field.name] = typeof field.value === "string" ? field.value : "";
  }
  return values;
}

declare global {
  interface HTMLElementTagNameMap {
    "zitadel-login": ZitadelLogin;
  }
}
