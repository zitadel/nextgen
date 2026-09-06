import { type ZitadelProject } from "@zitadel/api/config";
import type {
  CreateFlow201,
  CreateFlow201Step,
  CreateFlow201StepFieldsItem,
  CreateFlowBodyPurpose,
  SubmitFlowStepBody,
  SubmitFlowStepBodyChallengeResponse,
  SubmitFlowStepBodyFields,
} from "@zitadel/api/generated/model";
import { ApiError, apiErrorMessage } from "@zitadel/api/runtime/fetch";
import { zitadelTrustmarkInnerHtml } from "../internal/attribution-markup.js";
import type { Liquid, Template } from "liquidjs";
import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import "../atoms/index.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

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
import type { Branding } from "./branding.js";
import { stampExportparts } from "./exportparts.js";
import { createLiquidEngine, localiseFlowErrorKeys } from "./liquid.js";
import { en, builtinLocales, type Locale } from "./locales/index.js";
import { patchMandatoryGates } from "./mandatory-gates.js";
import { resolveApi, type ProjectAttrs } from "./resolve-api.js";
import { createSanitiser } from "./sanitiser.js";
import { ZitadelSurface } from "./surface.js";
import type { FlowError, FlowIdentity, LiquidContext } from "./template-context.js";
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

  private engine: Liquid | null = null;

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
    const props = changed as Map<string, unknown>;
    if (!props.has("response")) return;
    // `changed` holds the OLD value: nullish (`null` initializer, or
    // undefined when the property never changed before) means this commit
    // applied the first response — the initial paint, not a user-driven
    // step swap.
    void this.hydrateStepAfterRender(props.get("response") == null);
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
    await this.updateComplete;
    const atoms = this.shadowRoot?.querySelectorAll<LitElement>(
      "zl-field, zl-select, zl-checkbox, zl-button",
    );
    if (atoms) {
      await Promise.all(Array.from(atoms).map((atom) => atom.updateComplete));
    }
    this.applyValuesToFields();
    if (!initial || this.variant === "page") {
      this.moveFocusToFirstField(initial && this.variant === "page");
    }
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
   * "Secured with Zitadel" attribution chrome injected into every
   * template's page-shell footer slot. Controlled by
   * `branding.attribution.show_zitadel` — defaults to `true` for
   * community / OSS deployments. Licensed tenants can suppress the badge
   * entirely or swap it for a `custom_link` value.
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
      let wire: CreateFlow201;
      if (this.resumeFlowId) {
        wire = await getCurrentStep(api, this.resumeFlowId);
      } else {
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
    // Decided before the step is assigned: `maybeCompleteFlow` navigates a
    // turn later, and by then the terminal screen has already painted.
    this.completing = navigatesOnComplete(wire, this.postSignInUrl);
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

    // History API (ADR 022): keep exactly one same-document entry — the
    // sentinel — on the stack while the current step supports
    // back-navigation, so the browser's back gesture fires `popstate`
    // (handled in `onPopState`) instead of leaving the page. Arming only
    // on the unarmed → armed transition means consecutive back-capable
    // steps (and re-renders of the same step, e.g. after a failed submit)
    // never grow the stack. Steps without a `kind: "back"` action retire
    // the sentinel — the next back press then navigates the host page
    // (leaves the flow), which is correct.
    if (typeof window !== "undefined") {
      const hasBack = Boolean(wire.step.actions?.some((a) => a.kind === "back"));
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
          this.ignoreNextPop = true;
          history.back();
        }
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
      ? (localiseFlowErrorKeys(step.error, {
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
      // reconnect `<zl-passkey>` and start a second WebAuthn ceremony.
      challenge: this.loading ? null : (step.challenge ?? null),
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
    const missing: string[] = [];
    for (const field of this.response?.step.fields ?? []) {
      // A checkbox always submits a real boolean (`false` when unticked), so it
      // is never "missing"; a must-accept boolean is enforced by the schema
      // (`const: true`), not this gate.
      if (field.type === "checkbox") continue;
      if (field.required && (values.get(field.name) ?? "") === "") {
        missing.push(field.name);
      }
    }
    return missing;
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
    const { challenge: _dropped, ...stepWithoutChallenge } = this.response.step;
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
  ): Promise<void> {
    if (!this.response || this.loading) return;
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

/**
 * Whether a terminal step ends in a navigation rather than a screen: a
 * `redirect` with a URI, or a `show` whose handoff the widget exchanges before
 * sending the browser to `post-sign-in-url`. A `show` without a
 * `post-sign-in-url` is the host handling the handoff itself, and that screen
 * is the flow's own last word — it still renders.
 */
function navigatesOnComplete(wire: CreateFlow201, postSignInUrl: string | undefined): boolean {
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
