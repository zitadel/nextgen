import { getZitadelConfig, getApi, type ZitadelProject } from "@zitadel/api/config";
import type {
  CreateFlow201,
  CreateFlow201Step,
  CreateFlowBodyPurpose,
  SubmitFlowStepBody,
  SubmitFlowStepBodyChallengeResponse,
} from "@zitadel/api/generated/model";
import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { Liquid, Template } from "liquidjs";

import "../atoms/index.js";
import {
  exchangeSession,
  getCurrentStep,
  startFlow as apiStartFlow,
  submitStep as apiSubmitStep,
} from "./api-client.js";
import type { Branding } from "./branding.js";
import { applyBaseTokens, applyBrandingTokens } from "./branding-to-tokens.js";
import { validateBranding } from "./branding-validator.js";
import { applyFontUrl } from "./font-loader.js";
import { createLiquidEngine } from "./liquid.js";
import { TEMPLATE_NAMES } from "./template-names.js";
import { en, builtinLocales, type Locale } from "./locales/index.js";
import { patchMandatoryGates } from "./mandatory-gates.js";
import { zitadelAttributionPillInnerHtml } from "@zitadel/shared-component-styles/attribution-markup";
import { createSanitiser } from "./sanitiser.js";
import type { FlowError, LiquidContext } from "./template-context.js";
import layoutChromeCss from "./templates/layout-chrome.css?inline";
import { ThemeController } from "./theme-controller.js";

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
@customElement("zitadel-login")
export class ZitadelLogin extends LitElement {
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
      min-height: 100vh;
    }
  `;

  @property({ type: String }) accessor purpose: CreateFlowBodyPurpose = "login";

  /**
   * SDK project handle returned by `configureZitadel()`. When set, takes
   * precedence over the global singleton from `getZitadelConfig()`.
   */
  @property({ attribute: false }) accessor project: ZitadelProject | undefined;

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
   * step without losing collected state.
   */
  @property({ type: String, attribute: "resume-flow-id" }) accessor resumeFlowId = "";

  /**
   * BCP 47 language tag (e.g. `"de"`, `"en-US"`). The widget resolves this
   * to a built-in locale dictionary. Falls back to auto-detection from
   * `document.documentElement.lang` or `navigator.language` when empty.
   */
  @property({ type: String }) override accessor lang = "";

  /**
   * Custom locale dictionaries keyed by language code. When set, these take
   * precedence over the built-in dictionaries for matching language codes.
   *
   * ```ts
   * import { en } from "@zitadel/components";
   * const locales = {
   *   en: { ...en, "identifier.title": "Welcome" },
   *   de: myGermanDict,
   * };
   * ```
   */
  @property({ attribute: false }) accessor locales: Record<string, Locale> | undefined;

  @state() private accessor response: CreateFlow201 | null = null;

  @state() private accessor branding: Branding | undefined = undefined;

  @state() private accessor loading = false;

  @state() private accessor startupError: string | null = null;

  @state() private accessor formValues: Record<string, string> = {};

  private readonly themeController = new ThemeController(this);

  private engine: Liquid | null = null;

  private readonly sanitise = createSanitiser();

  /**
   * Cached compiled tenant template, keyed by source string. Re-rendering on
   * every `formValues` change otherwise re-parses the same template.
   */
  private tenantTemplateCache: { source: string; template: Template[] } | null = null;

  /**
   * Incrementing counter for opaque, fragment-based history entries
   * (`#s0`, `#s1`, …). The fragment has no semantic meaning — it exists
   * only to create same-document navigation entries so the browser's back
   * gesture fires `popstate` without reloading the page.
   */
  private stepSeq = 0;

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

    return custom ? { ...builtin, ...custom } : builtin;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (!this.engine || changed.has("locales") || changed.has("lang")) {
      this.engine = createLiquidEngine({ locale: this.resolveLocale() });
    }
    const root = this.shadowRoot;
    if (root) {
      applyBaseTokens(root);
      applyBrandingTokens(root, this.branding, this.themeController.theme);
      applyFontUrl(root, this.branding?.font_url ?? null);
    }
    this.dataset.theme = this.themeController.theme;
    this.toggleAttribute("data-theme-dark", this.themeController.theme === "dark");
    this.setAttribute("aria-busy", this.loading ? "true" : "false");
  }

  override updated(changed: PropertyValues<this>): void {
    const props = changed as Map<string, unknown>;
    if (!props.has("response")) return;
    // Step markup exists only after this commit; defer field hydration/focus.
    requestAnimationFrame(() => {
      this.applyValuesToFields();
      this.moveFocusToFirstField();
    });
  }

  override render() {
    if (this.startupError) {
      return html`<form class="zl-mount" novalidate>
        <zl-alert severity="error">${this.startupError}</zl-alert>
      </form>`;
    }
    if (!this.response || !this.engine) {
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
   */
  private injectAttribution(rendered: string): string {
    const html = this.renderAttributionHtml();
    if (!html) return rendered;
    if (rendered.includes("</zl-page-shell>")) {
      return rendered.replace("</zl-page-shell>", `${html}</zl-page-shell>`);
    }
    return rendered + html;
  }

  /**
   * "Secured with Zitadel" attribution chrome injected into every
   * template's page-shell footer slot. Controlled by
   * `branding.attribution.show_zitadel` — defaults to `true` for
   * community / OSS deployments. Licensed tenants can suppress the badge
   * entirely or swap it for a `custom_link` value.
   */
  private renderAttributionHtml(): string {
    const attribution = this.branding?.attribution;
    const show = attribution?.show_zitadel !== false;
    const custom = attribution?.custom_link;
    if (!show && !custom) {
      return "";
    }
    if (custom) {
      const safeHref = String(custom.href).replace(/"/g, "&quot;");
      const safeLabel = String(custom.label)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<div slot="footer" part="attribution" class="zl-attribution"><zl-pill tone="neutral" href="${safeHref}">${safeLabel}</zl-pill></div>`;
    }
    return `<div slot="footer" part="attribution" class="zl-attribution"><zl-pill tone="neutral" href="https://zitadel.com" part="attribution-pill" aria-label="Secured with Zitadel">${zitadelAttributionPillInnerHtml()}</zl-pill></div>`;
  }

  private async startFlow(): Promise<void> {
    const cfg = this.project ?? getZitadelConfig();

    // Resolve project ID from handle.
    const projectId = cfg?.projectId || "";

    if (!cfg) {
      throw new Error(
        "<zitadel-login> requires a `config` prop (from configureZitadel()) or configureZitadel() must be called before use.",
      );
    }
    const api = getApi(cfg);

    this.loading = true;
    this.startupError = null;
    try {
      let wire: CreateFlow201;
      if (this.resumeFlowId) {
        wire = await getCurrentStep(api, this.resumeFlowId);
      } else {
        if (!projectId) {
          throw new Error(
            "<zitadel-login> requires a `project-id` attribute (or configureZitadel()) to start a flow.",
          );
        }
        wire = await apiStartFlow(api, { project_id: projectId, purpose: this.purpose });
      }
      this.applyResponse(wire);
    } catch (error) {
      this.handleTransportError(error);
    } finally {
      this.loading = false;
    }
  }

  private applyResponse(wire: CreateFlow201): void {
    this.response = wire;
    const { branding, issues } = validateBranding(wire.branding);
    this.branding = branding;
    this.themeController.setBranding(branding);
    if (issues.length > 0) {
      console.warn("[zitadel-login] branding payload has issues:", issues);
    }
    // Defaults seed every declared field; existing entries (typed input,
    // carry-over from prior steps) win on conflict.
    this.formValues = { ...collectInitialValues(wire.step), ...this.formValues };

    // History API: push a new entry when the step supports back-navigation
    // so the browser's back gesture fires `popstate`. Steps without a `back`
    // action replace the current entry — the browser's back button then
    // navigates the host page (leaves the flow), which is correct.
    if (typeof window !== "undefined") {
      const hasBack = Boolean(wire.step.actions && "back" in wire.step.actions);
      if (hasBack) {
        history.pushState({ zl: true }, "", `#s${this.stepSeq++}`);
      } else {
        history.replaceState({ zl: true }, "");
      }
    }

    void this.maybeCompleteFlow(wire);
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

    this.dispatchEvent(
      new CustomEvent("zitadel-flow-complete", {
        bubbles: true,
        composed: true,
        detail: {
          behavior,
          redirect_uri: response.redirect_uri,
          handoff_token: response.handoff_token,
          handoff_token_expires_at: response.handoff_token_expires_at,
        },
      }),
    );

    if (typeof window === "undefined") return;
    if (behavior === "redirect" && response.redirect_uri) {
      window.location.assign(response.redirect_uri);
      return;
    }

    const handoffToken = response.handoff_token;
    if (behavior === "show" && handoffToken && this.postSignInUrl) {
      this.loading = true;
      try {
        const cfg = this.project ?? getZitadelConfig();
        if (!cfg) throw new Error("<zitadel-login> config is required for exchange.");
        const api = getApi(cfg);
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

    const errors: FlowError[] = step.error
      ? step.error.startsWith("error.")
        ? [{ text_key: step.error }]
        : [{ message: step.error }]
      : [];

    const context: LiquidContext = {
      step: {
        name: step.name,
        complete: step.complete,
        texts: step.texts ?? {},
      },
      fields: step.fields ?? {},
      actions: step.actions ?? {},
      gates: step.gates ?? {},
      sso_providers: step.sso_providers ?? [],
      challenge: step.challenge ?? null,
      messages: [],
      identity: this.deriveIdentity(),
      errors,
      branding: this.branding ?? {},
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
  private deriveIdentity(): import("./template-context.js").FlowIdentity | null {
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

  private applyValuesToFields(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const fields = root.querySelectorAll<HTMLElement & { value?: string }>("zl-field");
    if (fields.length === 0) return;
    for (const field of fields) {
      const name = field.getAttribute("name");
      if (!name || !(name in this.formValues)) continue;
      const next = this.formValues[name];
      if (field.value !== next) {
        field.value = next;
      }
    }
  }

  private handleAtomInput = (event: CustomEvent<{ name: string; value: string }>): void => {
    if (!event.detail) return;
    const { name, value } = event.detail;
    if (!name) return;
    this.formValues = { ...this.formValues, [name]: value };
    this.dispatchEvent(
      new CustomEvent("zitadel-flow-input", {
        bubbles: true,
        composed: true,
        detail: { name, value },
      }),
    );
  };

  private handleAtomSubmit = (event: CustomEvent<{ action: string | null }>): void => {
    if (this.loading) return;
    void this.submit(event.detail?.action ?? null);
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
    if (this.loading) return;
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
    event: CustomEvent<{ challenge_id: string; error: string; aborted: boolean }>,
  ): void => {
    if (!this.response) return;
    const { error: message, aborted } = event.detail;
    const errorKey = aborted ? "error.passkey_cancelled" : "error.passkey_failed";
    if (this.response.step.error === errorKey) return;
    const { challenge: _dropped, ...stepWithoutChallenge } = this.response.step;
    this.response = {
      ...this.response,
      step: { ...stepWithoutChallenge, error: errorKey },
    };
    console.warn(
      `[zitadel-login] passkey ceremony ${aborted ? "cancelled" : "failed"}: ${message}`,
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

  private moveFocusToFirstField(): void {
    const root = this.shadowRoot;
    if (!root) return;
    requestAnimationFrame(() => {
      const focusables = root.querySelectorAll<HTMLElement>("zl-field, zl-button");
      const target = Array.from(focusables).find((el) => !el.hasAttribute("disabled"));
      target?.focus();
    });
  }

  private async submit(
    action: string | null,
    challengeResponse?: SubmitFlowStepBodyChallengeResponse,
  ): Promise<void> {
    if (!this.response || this.loading) return;
    const { id, session_token } = this.response;
    this.loading = true;
    try {
      // Only send field values that the current step defines. `formValues`
      // carries state across steps (e.g. email for the signed-in greeting)
      // but steps without fields should not leak prior values onto the wire.
      const stepFieldKeys = Object.keys(this.response.step.fields ?? {});
      const fields: Record<string, string> = {};
      for (const key of stepFieldKeys) {
        const value = this.formValues[key];
        if (value !== undefined) {
          fields[key] = value;
        }
      }
      const body: SubmitFlowStepBody = {
        session_token,
        action: action ?? "submit",
        fields,
        ...(challengeResponse ? { challenge_response: challengeResponse } : {}),
      };
      const cfg = this.project ?? getZitadelConfig();
      if (!cfg) throw new Error("<zitadel-login> config is required for submit.");
      const api = getApi(cfg);
      const wire = await apiSubmitStep(api, id, body);
      this.applyResponse(wire);
      this.dispatchEvent(
        new CustomEvent("zitadel-flow-step", {
          bubbles: true,
          composed: true,
          detail: { step: wire.step },
        }),
      );
    } catch (error) {
      this.handleTransportError(error);
    } finally {
      this.loading = false;
    }
  }

  /**
   * Handle the browser's back gesture. When `popstate` fires and the current
   * step declares a `back` action, submit it to the flow API. Forward
   * navigation and steps without `back` are silently ignored (no-op) —
   * the displayed step does not change (ADR 016 §Edge cases).
   */
  private onPopState(_event: PopStateEvent): void {
    if (!this.response?.step?.actions) return;
    if ("back" in this.response.step.actions) {
      void this.submit("back");
    }
  }

  private handleTransportError(error: unknown): void {
    const message =
      error instanceof Error ? error.message : "Unexpected error contacting the Flow API.";
    this.startupError = message;
    console.error("[zitadel-login]", error);
    this.dispatchEvent(
      new CustomEvent("zitadel-flow-error", {
        bubbles: true,
        composed: true,
        detail: { message },
      }),
    );
  }
}

function collectInitialValues(step: CreateFlow201Step): Record<string, string> {
  const values: Record<string, string> = {};
  if (!step.fields) return values;
  for (const [name, field] of Object.entries(step.fields)) {
    values[name] = typeof field.value === "string" ? field.value : "";
  }
  return values;
}

declare global {
  interface HTMLElementTagNameMap {
    "zitadel-login": ZitadelLogin;
  }
}
