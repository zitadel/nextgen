import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { Liquid, Template } from "liquidjs";

import "../atoms/index.js";

import { applyBrandingTokens } from "./branding-to-tokens.js";
import { validateBranding } from "./branding-validator.js";
import { applyFontUrl } from "./font-loader.js";
import { createLiquidEngine, TEMPLATE_NAMES } from "./liquid.js";
import { en, type Locale } from "./locales/en.js";
import { patchMandatoryGates } from "./mandatory-gates.js";
import { createSanitiser } from "./sanitiser.js";
import { layoutChromeCss } from "./templates/default.liquid.js";
import { ThemeController } from "./theme-controller.js";
import {
  FetchTransport,
  type FlowTransport,
  FlowTransportError,
  type StartInput,
} from "./transport.js";
import type { Branding, FlowResponse, FlowStep } from "./types.js";

/**
 * `<zitadel-login>` — the auth-UI orchestrator.
 *
 * Reads step + branding payloads from a {@link FlowTransport}, renders them
 * through LiquidJS, sanitises the output via DOMPurify, mounts the result
 * inside a real `<form>` element in its Shadow DOM via Lit's `unsafeHTML`
 * directive, and wires atom CustomEvents (`zl-input` / `zl-submit` /
 * `zl-action`) and the form's native `submit` event back into the Flow API
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

  @property({ type: String }) accessor purpose = "login";

  @property({ type: String, attribute: "project-id" }) accessor projectId = "";

  @property({ type: String }) accessor issuer = "";

  /** Override transport for tests / dev playground. */
  @property({ attribute: false }) accessor transport: FlowTransport | null = null;

  /** Base URL when the orchestrator falls back to {@link FetchTransport}. */
  @property({ type: String, attribute: "base-url" }) accessor baseUrl = "";

  /** Override locale dict. Defaults to bundled `en`. */
  @property({ attribute: false }) accessor locale: Locale = en;

  @state() private accessor session: { id: string; token: string } | null = null;

  @state() private accessor step: FlowStep | null = null;

  @state() private accessor branding: Branding | undefined = undefined;

  @state() private accessor loading = false;

  @state() private accessor startupError: string | null = null;

  @state() private accessor formValues: Record<string, string> = {};

  private readonly themeController = new ThemeController(this);

  private engine: Liquid | null = null;

  private readonly sanitise = createSanitiser();

  // Cached compiled tenant template, keyed by source string. Re-rendering on
  // every `formValues` change otherwise re-parses the same template.
  private tenantTemplateCache: { source: string; template: Template[] } | null = null;

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();
    if (root instanceof ShadowRoot) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(layoutChromeCss);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      root.addEventListener("zl-input", this.handleAtomInput as EventListener);
      root.addEventListener("zl-submit", this.handleAtomSubmit as EventListener);
      root.addEventListener("zl-action", this.handleAtomAction as EventListener);
      // Native <form> submit fires on Enter inside any field and after the
      // browser's autofill / save-password handshake. Intercept it so we can
      // hand off to our flow-submit cycle without the page reloading.
      root.addEventListener("submit", this.handleFormSubmit as EventListener);
    }
    return root;
  }

  /**
   * Start the flow after the first render rather than in `connectedCallback`.
   * Frameworks that wrap web components (e.g. `@lit/react` in the console)
   * attach the element first and then assign object properties (`transport`,
   * `branding`, `locale`) via setters. `connectedCallback` runs synchronously
   * on attach — before any setters from a wrapper's effects/refs — so a flow
   * kicked off there would always see `transport === null` and throw
   * "requires either a `transport` property or a `base-url` attribute".
   * `firstUpdated` runs after Lit's first render, by which time setters from
   * the wrapping framework have fired, so `resolveTransport()` finds the
   * value the consumer assigned.
   */
  protected override firstUpdated(): void {
    void this.startFlow();
  }

  override willUpdate(): void {
    if (!this.engine) {
      this.engine = createLiquidEngine({ locale: this.locale });
    }
  }

  override updated(changed: Map<string, unknown>): void {
    const root = this.shadowRoot;
    if (!root) return;
    applyBrandingTokens(root, this.branding, this.themeController.theme);
    applyFontUrl(root, this.branding?.font_url ?? null);
    this.dataset.theme = this.themeController.theme;
    this.toggleAttribute("data-theme-dark", this.themeController.theme === "dark");
    this.setAttribute("aria-busy", this.loading ? "true" : "false");
    this.applyValuesToFields();
    if (changed.has("step")) {
      this.moveFocusToFirstField();
    }
  }

  override render() {
    if (this.startupError) {
      return html`<form class="zl-mount" novalidate>
        <zl-error message="${this.startupError}"></zl-error>
      </form>`;
    }
    if (!this.step || !this.engine) {
      return html`<slot name="loader"></slot>`;
    }
    const rendered = this.renderStep(this.step, this.engine);
    return html`<form
      class="zl-mount"
      part="form"
      novalidate
      aria-busy=${this.loading ? "true" : "false"}
    >
      ${unsafeHTML(rendered)}
    </form>`;
  }

  private resolveTransport(): FlowTransport {
    if (this.transport) {
      return this.transport;
    }
    if (!this.baseUrl) {
      throw new Error(
        "<zitadel-login> requires either a `transport` property or a `base-url` attribute.",
      );
    }
    this.transport = new FetchTransport({ baseUrl: this.baseUrl });
    return this.transport;
  }

  private buildStartInput(): StartInput {
    return {
      purpose: this.purpose,
      project_id: this.projectId || undefined,
      issuer: this.issuer || undefined,
    };
  }

  private async startFlow(): Promise<void> {
    this.loading = true;
    this.startupError = null;
    try {
      const transport = this.resolveTransport();
      const response = await transport.start(this.buildStartInput());
      this.applyResponse(response);
    } catch (error) {
      this.handleTransportError(error);
    } finally {
      this.loading = false;
    }
  }

  private applyResponse(response: FlowResponse): void {
    this.session = { id: response.session_id, token: response.session_token };
    this.step = response.step;
    const { branding, issues } = validateBranding(response.branding);
    this.branding = branding;
    this.themeController.setBranding(branding);
    if (issues.length > 0) {
      console.warn("[zitadel-login] branding payload has issues:", issues);
    }
    this.formValues = collectInitialValues(response.step);
  }

  private renderStep(step: FlowStep, engine: Liquid): string {
    const tenantSource =
      typeof this.branding?.liquid_template === "string" &&
      this.branding.liquid_template.length > 0
        ? this.branding.liquid_template
        : null;

    const context = {
      step: {
        name: step.name,
        type: step.type,
        texts: step.texts ?? {},
      },
      fields: step.fields ?? {},
      actions: step.actions ?? {},
      gates: step.gates ?? {},
      sso_providers: step.sso_providers ?? [],
      messages: step.messages ?? [],
      identity: step.identity ?? null,
      errors: step.errors ?? [],
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
        return `<zl-error message="We couldn't render this step."></zl-error>`;
      }
    }

    const patched = patchMandatoryGates(raw, step, this.locale);
    return this.sanitise(patched);
  }

  private applyValuesToFields(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const fields = root.querySelectorAll<HTMLElement & { value?: string }>("zl-field");
    if (fields.length === 0) return;
    for (const field of fields) {
      const name = field.getAttribute("name");
      if (name && name in this.formValues) {
        field.value = this.formValues[name];
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
    void this.submit(event.detail?.action ?? null);
  };

  private handleFormSubmit = (event: SubmitEvent): void => {
    // Always intercept: we own the submit cycle. Without this the page would
    // navigate to whatever `action` URL the form has (none) and lose state.
    event.preventDefault();
    if (this.loading) return;
    // `submitter` is the button that triggered the submit. When the user
    // pressed Enter inside a `<zl-field>`, the field calls
    // `form.requestSubmit()` with no submitter, so we fall back to the first
    // `<zl-submit>`'s action (the step's primary action).
    const submitter = event.submitter as HTMLElement | null;
    const explicit = submitter?.getAttribute?.("action") ?? null;
    const action = explicit ?? this.findPrimaryAction();
    void this.submit(action);
  };

  private findPrimaryAction(): string | null {
    const root = this.shadowRoot;
    if (!root) return null;
    const submit = root.querySelector("zl-submit");
    return submit?.getAttribute("action") || null;
  }

  private moveFocusToFirstField(): void {
    const root = this.shadowRoot;
    if (!root) return;
    requestAnimationFrame(() => {
      const focusables = root.querySelectorAll<HTMLElement>(
        "zl-field, zl-action, zl-submit",
      );
      const target = Array.from(focusables).find((el) => !el.hasAttribute("disabled"));
      target?.focus();
    });
  }

  private handleAtomAction = (event: CustomEvent<{ action: string | null }>): void => {
    const action = event.detail?.action ?? null;
    this.dispatchEvent(
      new CustomEvent("zitadel-flow-action", {
        bubbles: true,
        composed: true,
        detail: { action },
      }),
    );
    if (action) {
      void this.submit(action);
    }
  };

  private async submit(action: string | null): Promise<void> {
    if (!this.session || !this.step) return;
    this.loading = true;
    try {
      const transport = this.resolveTransport();
      const response = await transport.submit({
        session_id: this.session.id,
        session_token: this.session.token,
        payload: {
          action,
          step: this.step.name,
          values: { ...this.formValues },
        },
      });
      this.applyResponse(response);
      this.dispatchEvent(
        new CustomEvent("zitadel-flow-step", {
          bubbles: true,
          composed: true,
          detail: { step: response.step },
        }),
      );
    } catch (error) {
      this.handleTransportError(error);
    } finally {
      this.loading = false;
    }
  }

  private handleTransportError(error: unknown): void {
    const message =
      error instanceof FlowTransportError
        ? `Flow API error (${error.status})`
        : error instanceof Error
          ? error.message
          : "Unexpected error contacting the Flow API.";
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

function collectInitialValues(step: FlowStep): Record<string, string> {
  const values: Record<string, string> = {};
  if (!step.fields) return values;
  for (const [name, field] of Object.entries(step.fields)) {
    values[name] = field.value ?? "";
  }
  return values;
}

declare global {
  interface HTMLElementTagNameMap {
    "zitadel-login": ZitadelLogin;
  }
}
