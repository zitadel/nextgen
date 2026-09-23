import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import ssoStyles from "./zl-sso-providers.css?inline";

import { emit } from "../internal/emit.js";
import type { AtomManifest } from "../manifest.js";
import { baseHostStyles, surfaceStyles } from "../styles/index.js";

import { SHIPPED_BRAND_ICON_NAMES, type BrandIconName } from "./zl-icon.js";
import "./zl-button.js";
import "./zl-icon.js";

/** One entry of the step's `sso_providers`, as the engine renders it. */
export type SsoProvider = {
  /** Connection id to send back as `sso_provider_id`. */
  readonly id: string;
  /** Vendor name to show, already localised by the server. */
  readonly name: string;
  /** Catalog template (`google`, `github`, …) — picks the mark. */
  readonly template?: string;
};

/** What a provider button reports when it is chosen. */
export type ZlSsoSelectDetail = {
  readonly providerId: string;
  readonly template: string | undefined;
  readonly name: string;
};

/** Placeholder the label format substitutes the vendor name into. */
const NAME_PLACEHOLDER = "{name}";

/**
 * Atom: `<zl-sso-providers>` — one button per identity provider the step
 * offers.
 *
 * Driven entirely by data. The step carries `sso_providers`, each entry a
 * `{id, name, template}` the engine resolved from the connection, and this
 * atom renders one button each in the order given. Nothing here knows which
 * vendors exist: Google ships today and GitHub, Microsoft and the rest arrive
 * as catalog entries plus a mark in `<zl-icon>`, with no change to this file.
 *
 * A template with no mark of its own still gets a working button, labelled
 * with the vendor's name and no glyph. That is deliberate — a placeholder
 * glyph would be a wrong logo, and a tenant's private OIDC connection is
 * exactly the case that will never have artwork here.
 *
 * Choosing one emits `zl-sso-select`; the orchestrator submits
 * `{action: "sso", sso_provider_id}` and follows the redirect the server
 * answers with. The atom does not navigate: the flow owns that, as it owns
 * every other transition.
 *
 * Because the answer to a click is a full-page redirect, the chosen button
 * takes a loading state and the rest are disabled — the page is on its way
 * out, and a second click would start a second authorization request.
 */
@customElement("zl-sso-providers")
export class ZlSsoProviders extends LitElement {
  static override styles = [baseHostStyles, ...surfaceStyles(ssoStyles)];

  /**
   * The providers to offer. Accepts a JSON string so a Liquid template can
   * pass the step's array straight through (`providers='{{ sso_providers |
   * json }}'`), exactly as `<zl-select>` takes its options.
   */
  @property({
    converter: {
      fromAttribute: (value: string | null): readonly SsoProvider[] => parseProviders(value),
      toAttribute: (value: readonly SsoProvider[]): string => JSON.stringify(value),
    },
  })
  accessor providers: readonly SsoProvider[] = [];

  /**
   * Button label, with `{name}` standing in for the vendor. Passed in
   * already localised; the fallback is English so a template that forgets it
   * still renders a sentence rather than a key.
   */
  @property({ attribute: "label-format" }) accessor labelFormat = `Continue with ${NAME_PLACEHOLDER}`;

  /** Text for the rule above the buttons. Omitted renders no rule. */
  @property({ attribute: "divider-label" }) accessor dividerLabel: string | undefined = undefined;

  /** Disables every button, e.g. while the step is already submitting. */
  @property({ type: Boolean, reflect: true }) accessor disabled = false;

  /** The provider whose redirect is in flight, if any. */
  @state() private accessor pendingId: string | undefined = undefined;

  override render() {
    const providers = this.providers.filter(isRenderable);
    if (providers.length === 0) {
      return nothing;
    }
    return html`
      <div class="zr-sso" part="root">
        ${this.dividerLabel
          ? html`<div class="zr-sso__divider" part="divider" role="separator" aria-orientation="horizontal">
              <span>${this.dividerLabel}</span>
            </div>`
          : nothing}
        <div class="zr-sso__list" part="list">
          ${providers.map((provider) => this.renderProvider(provider))}
        </div>
      </div>
    `;
  }

  private renderProvider(provider: SsoProvider) {
    const mark = brandIconFor(provider.template);
    const pending = this.pendingId === provider.id;
    return html`
      <zl-button
        part="provider"
        exportparts="root: provider-button"
        hierarchy="secondary"
        size="medium"
        type="button"
        block
        data-provider=${provider.id}
        data-template=${provider.template ?? nothing}
        data-testid=${`zitadel-sso-provider-${provider.template ?? provider.id}`}
        ?disabled=${this.disabled || (this.pendingId !== undefined && !pending)}
        ?loading=${pending}
        label=${this.labelFor(provider)}
        @click=${() => this.choose(provider)}
      >
        ${mark
          ? html`<span slot="leading" class="zr-sso__mark"
              ><zl-icon name=${mark} size="24" decorative></zl-icon
            ></span>`
          : nothing}
      </zl-button>
    `;
  }

  /** The vendor's name in the caller's sentence; `{name}` may repeat. */
  private labelFor(provider: SsoProvider): string {
    return this.labelFormat.split(NAME_PLACEHOLDER).join(provider.name);
  }

  private choose(provider: SsoProvider): void {
    if (this.disabled || this.pendingId !== undefined) {
      return;
    }
    this.pendingId = provider.id;
    emit<ZlSsoSelectDetail>(this, "zl-sso-select", {
      providerId: provider.id,
      template: provider.template,
      name: provider.name,
    });
  }

  /**
   * Clear the in-flight state. The orchestrator calls this when a submit
   * fails, because the promised redirect never came and the buttons would
   * otherwise stay dead for the life of the step.
   */
  reset(): void {
    this.pendingId = undefined;
  }
}

/**
 * Parse the `providers` attribute. Malformed JSON renders nothing rather than
 * throwing: the attribute is server data reaching a template, and a broken
 * payload must not take the whole sign-in screen down with it.
 */
function parseProviders(value: string | null): readonly SsoProvider[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as SsoProvider[]).filter(isRenderable) : [];
  } catch {
    return [];
  }
}

/** An entry with no id cannot be submitted, and one with no name has nothing to show. */
function isRenderable(provider: SsoProvider | undefined): provider is SsoProvider {
  return (
    provider !== undefined &&
    typeof provider.id === "string" &&
    provider.id !== "" &&
    typeof provider.name === "string" &&
    provider.name !== ""
  );
}

/** The mark for a template, or `undefined` when none has been drawn yet. */
function brandIconFor(template: string | undefined): BrandIconName | undefined {
  if (template === undefined) {
    return undefined;
  }
  const name = `brand-${template}`;
  return (SHIPPED_BRAND_ICON_NAMES as readonly string[]).includes(name)
    ? (name as BrandIconName)
    : undefined;
}

export const zlSsoProvidersManifest: AtomManifest = {
  tag: "zl-sso-providers",
  attrs: ["providers", "label-format", "divider-label", "disabled", "data-testid"],
  parts: ["root", "divider", "list", "provider", "provider-button"],
  slots: [],
  events: ["zl-sso-select"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-sso-providers": ZlSsoProviders;
  }
}
