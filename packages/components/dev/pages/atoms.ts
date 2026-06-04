import { zitadelAttributionPillInnerHtml } from "@zitadel/shared-component-styles/attribution-markup";

/**
 * Atom playground. Renders each shipped `<zl-*>` atom in isolation so we can
 * verify states (default, loading, ghost, error, dark) without booting the
 * full orchestrator. Tokens come from `@zitadel/design-tokens`; the
 * playground only adds a thin light-mode preview wrapper for atoms that ship
 * a dual-mode design.
 */
// hmr-bump: zl-card + zl-page-shell playgrounds

export function renderAtomPlayground(host: HTMLElement): void {
  host.innerHTML = `
    <div class="grid">
      <section class="card" style="grid-column: 1 / -1">
        <h3>zl-field — Figma master variant set (4390:1404)</h3>
        <div class="scope">
          ${renderFieldMatrix()}
        </div>
      </section>

      <section class="card" style="grid-column: 1 / -1">
        <h3>zl-button — Figma master variant set (6598:292)</h3>
        <div class="scope" data-testid="zl-button-matrix">
          ${renderButtonCoreMatrix()}
          ${renderButtonVariantsMatrix()}
        </div>
      </section>
      <!-- end button section -->

      <section class="card" style="grid-column: 1 / -1">
        <h3>zl-alert — Figma master Alert/Error (6593:2640) × severities</h3>
        <div class="scope">
          ${renderAlertMatrix()}
        </div>
      </section>

      <section class="card">
        <h3>zl-pill — Figma attribution chip (6593:141767)</h3>
        <div class="scope">
          <div class="row">
            <zl-pill tone="neutral" href="https://zitadel.com" aria-label="Secured with Zitadel">${zitadelAttributionPillInnerHtml()}</zl-pill>
            <zl-pill tone="pink">New</zl-pill>
            <zl-pill tone="purple">Beta</zl-pill>
            <zl-pill tone="orange">Preview</zl-pill>
            <zl-pill tone="success">Active</zl-pill>
          </div>
        </div>
      </section>

      <section class="card" style="grid-column: 1 / -1">
        <h3>zl-icon — Figma Icons set (4103:10466) × auth glyphs</h3>
        <div class="scope">
          ${renderIconMatrix()}
        </div>
      </section>

      <section class="card" style="grid-column: 1 / -1">
        <h3>zl-card — Figma sign-in / sign-up surfaces (6593:141985 · 6593:141743)</h3>
        <div class="scope">
          ${renderCardSurfaceMatrix()}
        </div>
      </section>

      <section class="card" style="grid-column: 1 / -1">
        <h3>zl-page-shell — Figma 2xl auth frame (6593:141741)</h3>
        <div class="page-shell-frame" data-testid="page-shell-demo">
          ${renderPageShellDemo()}
        </div>
      </section>
    </div>
  `;
}

/** Sign-in wireframe: fields + forgot link + primary CTA (Figma 6593:141989). */
function renderSignInCardDemoBody(): string {
  return `
    <div class="card-demo-stack" aria-hidden="true">
      <div class="card-demo-field"></div>
      <div class="card-demo-field"></div>
      <div class="card-demo-link"></div>
      <div class="card-demo-btn"></div>
    </div>
  `;
}

/** Sign-up wireframe: fields + password help + primary CTA (Figma 6593:141747). */
function renderSignUpCardDemoBody(): string {
  return `
    <div class="card-demo-stack" aria-hidden="true">
      <div class="card-demo-field"></div>
      <div class="card-demo-field"></div>
      <div class="card-demo-help"></div>
      <div class="card-demo-btn"></div>
    </div>
  `;
}

function renderCardSurfaceMatrix(): string {
  return `
    <div class="card-surface-matrix" data-testid="card-matrix">
      <div>
        <span class="card-surface-matrix__label">Standard · 32px slot gap · 6593:141985</span>
        <zl-card>
          <h1 slot="header" class="zl-card-title">Sign in</h1>
          ${renderSignInCardDemoBody()}
        </zl-card>
      </div>
      <div>
        <span class="card-surface-matrix__label">Sign-up · 32px slot gap · 6593:141743</span>
        <zl-card>
          <h1 slot="header" class="zl-card-title">Create your account</h1>
          ${renderSignUpCardDemoBody()}
        </zl-card>
      </div>
    </div>
    <p class="card-surface-matrix__note">Layout-only wireframes. Real fields and copy: <a href="?route=login">?route=login</a> (Purpose → Sign up).</p>
  `;
}

function renderPageShellDemo(): string {
  return `
    <zl-page-shell data-embedded>
      <zl-card>
        <h1 slot="header" class="zl-card-title">Sign in</h1>
        ${renderSignInCardDemoBody()}
      </zl-card>
      <div slot="footer">
        <zl-pill tone="neutral" href="https://zitadel.com" aria-label="Secured with Zitadel">${zitadelAttributionPillInnerHtml()}</zl-pill>
      </div>
    </zl-page-shell>
  `;
}

type ButtonHierarchy = { id: "primary" | "secondary" | "text"; label: string };
type ButtonSize = { id: "medium" | "small"; label: string; iconSize: "16" | "24" };

const HIERARCHIES: ButtonHierarchy[] = [
  { id: "primary", label: "Primary" },
  { id: "secondary", label: "Secondary" },
  { id: "text", label: "Text" },
];

const ICON_GLYPHS = [
  "plus",
  "arrow-right",
  "arrow-left",
  "spinner",
  "check",
  "cross",
  "warning",
  "alert-circle",
  "info",
  "passkey",
  "user",
  "eye",
  "eye-off",
] as const;

/**
 * Icons set `4103:10466` — rows 16px | 24px, columns per shipped glyph + semantic tones.
 */
function renderIconMatrix(): string {
  const cell = (name: string, size: "16" | "24", extra = "") =>
    `<div class="icon-matrix__cell"><zl-icon name="${name}" size="${size}"${extra}></zl-icon></div>`;
  const spin = (name: string) => (name === "spinner" ? " spin" : "");
  const toneRows = [
    { label: "default", attrs: "" },
    { label: "error", attrs: ' tone="error"' },
    { label: "success", attrs: ' tone="success"' },
    { label: "disabled", attrs: ' tone="disabled"' },
  ];
  const sizeRow = (size: "16" | "24", label: string) => `
    <div class="icon-matrix__row">
      <span class="row-header">${label}</span>
      ${ICON_GLYPHS.map((name) => cell(name, size, spin(name))).join("")}
    </div>
  `;
  return `
    <div class="icon-matrix" data-testid="icon-matrix">
      <div class="icon-matrix__head">
        <span class="row-header">Size</span>
        ${ICON_GLYPHS.map((name) => `<span class="col-header">${name}</span>`).join("")}
      </div>
      ${sizeRow("16", "16px")}
      ${sizeRow("24", "24px")}
      <div class="icon-matrix__tones-section">
        <span class="group-header">Semantic tones · alert-circle · 24px</span>
        <div class="icon-matrix__tones">
          ${toneRows
            .map(
              (t) => `
            <div class="icon-matrix__tone">
              <span class="tone-label">${t.label}</span>
              ${cell("alert-circle", "24", t.attrs)}
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
}

type AlertSeverity = "error" | "warning" | "success" | "info";

/**
 * Alert master `6593:2640` × 4 severities × { body, +heading, +dismissible }.
 */
function renderAlertMatrix(): string {
  const cols = [
    { header: "Body", heading: "", dismissible: false },
    { header: "+ Heading", heading: "Title", dismissible: false },
    { header: "+ Dismiss", heading: "Title", dismissible: true },
  ] as const;
  const rows: Array<{
    severity: AlertSeverity;
    label: string;
    body: string;
    heading?: string;
  }> = [
    {
      severity: "error",
      label: "Error",
      heading: "We couldn’t complete your sign in.",
      body: "Please try again in a few minutes",
    },
    {
      severity: "warning",
      label: "Warning",
      heading: "Are you sure?",
      body: "Heads up — this action can’t be undone.",
    },
    {
      severity: "success",
      label: "Success",
      heading: "Saved",
      body: "Your changes were saved.",
    },
    {
      severity: "info",
      label: "Info",
      heading: "Tip",
      body: "A passkey makes future sign-ins faster.",
    },
  ];
  const cell = (
    severity: AlertSeverity,
    body: string,
    heading: string,
    dismissible: boolean,
  ) => {
    const headingAttr = heading ? ` heading="${heading}"` : "";
    const dismissAttr = dismissible ? " dismissible" : "";
    return `<zl-alert severity="${severity}"${headingAttr}${dismissAttr}>${body}</zl-alert>`;
  };
  return `
    <div class="alert-matrix" data-testid="alert-matrix">
      <span></span>
      ${cols.map((c) => `<span class="col-header">${c.header}</span>`).join("")}
      ${rows
        .map(
          (row) => `
        <span class="row-header">${row.label}</span>
        ${cols
          .map((col) => {
            const title = col.heading === "Title" ? row.heading ?? "" : "";
            return cell(row.severity, row.body, title, col.dismissible);
          })
          .join("")}
      `,
        )
        .join("")}
    </div>
  `;
}

/**
 * Text Field master `4390:1404` — every column from the design-system variant set.
 */
function renderFieldMatrix(): string {
  const cols: Array<{ header: string; attrs: string; body?: string }> = [
    { header: "Enabled", attrs: ' placeholder="Input"' },
    { header: "Hovered", attrs: ' data-state="hovered" placeholder="Input"' },
    { header: "Focused", attrs: ' data-state="focused" placeholder="Input"' },
    { header: "Filled", attrs: ' value="Input"' },
    { header: "Disabled", attrs: ' placeholder="Input" disabled' },
    {
      header: "Error",
      attrs: ' value="Input" invalid error="Supporting text"',
      body: "",
    },
    {
      header: "Success",
      attrs: ' value="Input" success="Supporting text"',
    },
  ];
  const cell = (id: string, attrs: string) =>
    `<zl-field name="field-${id}" label="Label" type="text"${attrs}></zl-field>`;
  return `
    <div class="field-matrix" data-testid="field-matrix">
      <span></span>
      ${cols.map((c) => `<span class="col-header">${c.header}</span>`).join("")}
      <span class="row-header">Default</span>
      ${cols.map((c, i) => cell(String(i), c.attrs)).join("")}
      <span class="group-header">Password forgot</span>
      <span class="row-header">Link row</span>
      <zl-field
        name="field-forgot"
        label="Label"
        type="password"
        placeholder="Input"
        forgot-password-href="#"
        forgot-password-label="Forgot password?"
      >
        <span slot="help">Supporting text</span>
      </zl-field>
    </div>
  `;
}

const SIZES: ButtonSize[] = [
  { id: "medium", label: "Medium", iconSize: "24" },
  { id: "small", label: "Small", iconSize: "16" },
];

/**
 * Core state matrix per Figma master variant set (6598:292): each cell
 * shows the button with leading + label + trailing plus icons so the
 * icon's contrast against background varies visibly across states.
 */
function renderButtonCoreMatrix(): string {
  const states: Array<{ key: "enabled" | "hovered" | "focused" | "pressed" | "disabled"; attr: string }> = [
    { key: "enabled", attr: "" },
    { key: "hovered", attr: ' data-state="hovered"' },
    { key: "focused", attr: ' data-state="focused"' },
    { key: "pressed", attr: ' data-state="pressed"' },
    { key: "disabled", attr: " disabled" },
  ];
  const cell = (h: ButtonHierarchy, s: ButtonSize, attr: string) => `
    <zl-button hierarchy="${h.id}" size="${s.id}" label="Label"${attr}>
      <zl-icon slot="leading" name="plus" size="${s.iconSize}" decorative></zl-icon>
      <zl-icon slot="trailing" name="plus" size="${s.iconSize}" decorative></zl-icon>
    </zl-button>`;
  const rows = SIZES.map((size) => `
    <span class="group-header">${size.label}</span>
    ${HIERARCHIES.map((h) => `
      <span class="row-header">${h.label}</span>
      ${states.map((st) => cell(h, size, st.attr)).join("")}
    `).join("")}
  `).join("");
  return `
    <div class="btn-matrix" data-section="core">
      <span></span>
      <span class="col-header">Enabled</span>
      <span class="col-header">Hovered</span>
      <span class="col-header">Focused</span>
      <span class="col-header">Pressed</span>
      <span class="col-header">Disabled</span>
      ${rows}
    </div>
  `;
}

/**
 * Variants matrix per Figma master variant set (6598:292): compositional
 * variants of the button content (label-only, leading icon, trailing
 * icon, loading, icon-only) for every hierarchy × size combination, all
 * rendered in the enabled state.
 */
function renderButtonVariantsMatrix(): string {
  const variants: Array<{ key: string; label: string }> = [
    { key: "none", label: "None" },
    { key: "leading", label: "Leading" },
    { key: "trailing", label: "Trailing" },
    { key: "loading", label: "Loading" },
    { key: "icon", label: "Icon-only" },
  ];
  const cell = (h: ButtonHierarchy, s: ButtonSize, variant: string) => {
    const ic = s.iconSize;
    switch (variant) {
      case "none":
        return `<zl-button hierarchy="${h.id}" size="${s.id}" label="None"></zl-button>`;
      case "leading":
        return `<zl-button hierarchy="${h.id}" size="${s.id}" label="Leading">
          <zl-icon slot="leading" name="plus" size="${ic}" decorative></zl-icon>
        </zl-button>`;
      case "trailing":
        return `<zl-button hierarchy="${h.id}" size="${s.id}" label="Trailing">
          <zl-icon slot="trailing" name="plus" size="${ic}" decorative></zl-icon>
        </zl-button>`;
      case "loading":
        return `<zl-button hierarchy="${h.id}" size="${s.id}" label="Loading" loading></zl-button>`;
      case "icon":
        return `<zl-button hierarchy="${h.id}" size="${s.id}" aria-label="Add">
          <zl-icon slot="leading" name="plus" size="${ic}" decorative></zl-icon>
        </zl-button>`;
      default:
        return "";
    }
  };
  const rows = SIZES.map((size) => `
    <span class="group-header">${size.label}</span>
    ${HIERARCHIES.map((h) => `
      <span class="row-header">${h.label}</span>
      ${variants.map((v) => cell(h, size, v.key)).join("")}
    `).join("")}
  `).join("");
  return `
    <div class="btn-variants" data-section="variants">
      <span></span>
      ${variants.map((v) => `<span class="col-header">${v.label}</span>`).join("")}
      ${rows}
    </div>
  `;
}
