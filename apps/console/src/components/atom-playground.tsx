import type { IconName, IconSize, IconTone } from "@zitadel-nextgen/ui-react";
import {
  Alert,
  Button,
  Card,
  Icon,
  PageShell,
  Pill,
  TextField,
  ZitadelAttributionPillLabel,
} from "@zitadel-nextgen/ui-react";
import { Fragment, type JSX, type ReactNode } from "react";

const GLYPHS: IconName[] = [
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
];

type ButtonHierarchy = "primary" | "secondary" | "text";
type ButtonSize = "medium" | "small";

const HIERARCHIES: Array<{ id: ButtonHierarchy; label: string }> = [
  { id: "primary", label: "Primary" },
  { id: "secondary", label: "Secondary" },
  { id: "text", label: "Text" },
];

const SIZES: Array<{ id: ButtonSize; label: string; iconSize: IconSize }> = [
  { id: "medium", label: "Medium", iconSize: "24" },
  { id: "small", label: "Small", iconSize: "16" },
];

function FieldMatrixCell(props: {
  label: string;
  /** Playground-only Figma column preview; not a TextField prop. */
  previewState?: "hovered" | "focused";
  placeholder?: string;
  defaultValue?: string;
  disabled?: boolean;
  invalid?: boolean;
  error?: string;
  success?: string;
  forgotPasswordHref?: string;
  type?: "text" | "email" | "password";
  help?: string;
}): JSX.Element {
  const field = (
    <TextField
      name={`field-${props.label}`}
      label="Label"
      type={props.type ?? "text"}
      placeholder={props.placeholder}
      defaultValue={props.defaultValue}
      disabled={props.disabled}
      invalid={props.invalid}
      error={props.error}
      success={props.success}
      forgotPasswordHref={props.forgotPasswordHref}
      help={props.help}
    />
  );
  if (!props.previewState) {
    return field;
  }
  return (
    <div className="field-matrix__cell" data-state={props.previewState}>
      {field}
    </div>
  );
}

function FieldsCard(): JSX.Element {
  const cols = [
    { header: "Enabled", props: { placeholder: "Input" } },
    { header: "Hovered", props: { placeholder: "Input", previewState: "hovered" as const } },
    { header: "Focused", props: { placeholder: "Input", previewState: "focused" as const } },
    { header: "Filled", props: { defaultValue: "Input" } },
    { header: "Disabled", props: { placeholder: "Input", disabled: true } },
    {
      header: "Error",
      props: { defaultValue: "Input", invalid: true, error: "Supporting text" },
    },
    {
      header: "Success",
      props: { defaultValue: "Input", success: "Supporting text" },
    },
  ] as const;

  return (
    <section className="card" style={{ gridColumn: "1 / -1" }}>
      <h3>TextField — Figma master variant set (4390:1404)</h3>
      <div className="scope">
        <div className="field-matrix" data-testid="field-matrix">
          <span />
          {cols.map((c) => (
            <span key={c.header} className="col-header">
              {c.header}
            </span>
          ))}
          <span className="row-header">Default</span>
          {cols.map((c) => (
            <FieldMatrixCell key={c.header} label={c.header} {...c.props} />
          ))}
          <span className="group-header">Password forgot</span>
          <span className="row-header">Link row</span>
          <FieldMatrixCell
            label="forgot"
            type="password"
            placeholder="Input"
            forgotPasswordHref="#"
            help="Supporting text"
          />
        </div>
      </div>
    </section>
  );
}

function ButtonCoreMatrix(): JSX.Element {
  const states: Array<{ attr?: string; disabled?: boolean }> = [
    {},
    { attr: "hovered" },
    { attr: "focused" },
    { attr: "pressed" },
    { disabled: true },
  ];
  const icon = (size: IconSize) => <Icon name="plus" size={size} decorative />;

  return (
    <div className="btn-matrix" data-section="core">
      <span />
      <span className="col-header">Enabled</span>
      <span className="col-header">Hovered</span>
      <span className="col-header">Focused</span>
      <span className="col-header">Pressed</span>
      <span className="col-header">Disabled</span>
      {SIZES.map((size) => (
        <Fragment key={size.id}>
          <span className="group-header">{size.label}</span>
          {HIERARCHIES.map((h) => (
            <Fragment key={h.id}>
              <span className="row-header">{h.label}</span>
              {states.map((st, i) => (
                <Button
                  key={i}
                  hierarchy={h.id}
                  size={size.id}
                  label="Label"
                  leading={icon(size.iconSize)}
                  trailing={icon(size.iconSize)}
                  disabled={st.disabled}
                  data-state={st.attr}
                />
              ))}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

function ButtonVariantsMatrix(): JSX.Element {
  const variants: Array<{
    key: string;
    label: string;
    render: (h: ButtonHierarchy, size: ButtonSize, iconSize: IconSize) => ReactNode;
  }> = [
    { key: "none", label: "None", render: (h, s) => <Button hierarchy={h} size={s} label="None" /> },
    {
      key: "leading",
      label: "Leading",
      render: (h, s, ic) => (
        <Button hierarchy={h} size={s} label="Leading" leading={<Icon name="plus" size={ic} decorative />} />
      ),
    },
    {
      key: "trailing",
      label: "Trailing",
      render: (h, s, ic) => (
        <Button hierarchy={h} size={s} label="Trailing" trailing={<Icon name="plus" size={ic} decorative />} />
      ),
    },
    {
      key: "loading",
      label: "Loading",
      render: (h, s) => <Button hierarchy={h} size={s} label="Loading" loading />,
    },
    {
      key: "icon",
      label: "Icon-only",
      render: (h, s, ic) => (
        <Button hierarchy={h} size={s} aria-label="Add" leading={<Icon name="plus" size={ic} decorative />} />
      ),
    },
  ];

  return (
    <div className="btn-variants" data-section="variants">
      <span />
      {variants.map((v) => (
        <span key={v.key} className="col-header">
          {v.label}
        </span>
      ))}
      {SIZES.map((size) => (
        <Fragment key={size.id}>
          <span className="group-header">{size.label}</span>
          {HIERARCHIES.map((h) => (
            <Fragment key={h.id}>
              <span className="row-header">{h.label}</span>
              {variants.map((v) => (
                <span key={v.key}>{v.render(h.id, size.id, size.iconSize)}</span>
              ))}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

function ButtonsCard(): JSX.Element {
  return (
    <section className="card" style={{ gridColumn: "1 / -1" }}>
      <h3>Button — Figma master variant set (6598:292)</h3>
      <div className="scope" data-testid="button-matrix">
        <ButtonCoreMatrix />
        <ButtonVariantsMatrix />
      </div>
    </section>
  );
}

type AlertSeverity = "error" | "warning" | "success" | "info";

const ALERT_MATRIX_ROWS: Array<{
  severity: AlertSeverity;
  label: string;
  body: string;
  heading: string;
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

function AlertsCard(): JSX.Element {
  const cols = [
    { header: "Body", heading: false, dismissible: false },
    { header: "+ Heading", heading: true, dismissible: false },
    { header: "+ Dismiss", heading: true, dismissible: true },
  ] as const;

  return (
    <section className="card" style={{ gridColumn: "1 / -1" }}>
      <h3>Alert — Figma master Alert/Error (6593:2640) × severities</h3>
      <div className="scope">
        <div className="alert-matrix" data-testid="alert-matrix">
          <span />
          {cols.map((c) => (
            <span key={c.header} className="col-header">
              {c.header}
            </span>
          ))}
          {ALERT_MATRIX_ROWS.map((row) => (
            <Fragment key={row.severity}>
              <span className="row-header">{row.label}</span>
              {cols.map((col) => (
                <Alert
                  key={`${row.severity}-${col.header}`}
                  severity={row.severity}
                  heading={col.heading ? row.heading : undefined}
                  dismissible={col.dismissible}
                >
                  {row.body}
                </Alert>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

function PillsCard(): JSX.Element {
  return (
    <section className="card">
      <h3>zl-pill — Figma attribution chip (6593:141767)</h3>
      <div className="scope" data-testid="pill-matrix">
        <div className="row">
          <Pill tone="neutral" href="https://zitadel.com" aria-label="Secured with Zitadel">
            <ZitadelAttributionPillLabel />
          </Pill>
          <Pill tone="pink">New</Pill>
          <Pill tone="purple">Beta</Pill>
          <Pill tone="orange">Preview</Pill>
          <Pill tone="success">Active</Pill>
        </div>
      </div>
    </section>
  );
}

function SignInCardDemoBody(): JSX.Element {
  return (
    <div className="card-demo-stack" aria-hidden>
      <div className="card-demo-field" />
      <div className="card-demo-field" />
      <div className="card-demo-link" />
      <div className="card-demo-btn" />
    </div>
  );
}

function SignUpCardDemoBody(): JSX.Element {
  return (
    <div className="card-demo-stack" aria-hidden>
      <div className="card-demo-field" />
      <div className="card-demo-field" />
      <div className="card-demo-help" />
      <div className="card-demo-btn" />
    </div>
  );
}

function CardsCard(): JSX.Element {
  return (
    <section className="card" style={{ gridColumn: "1 / -1" }}>
      <h3>zl-card — Figma sign-in / sign-up surfaces (6593:141985 · 6593:141743)</h3>
      <div className="scope">
        <div className="card-surface-matrix" data-testid="card-matrix">
          <div>
            <span className="card-surface-matrix__label">Standard · 32px slot gap · 6593:141985</span>
            <Card header={<h1 className="zl-card-title">Sign in</h1>}>
              <SignInCardDemoBody />
            </Card>
          </div>
          <div>
            <span className="card-surface-matrix__label">Sign-up · 32px slot gap · 6593:141743</span>
            <Card
              header={<h1 className="zl-card-title">Create your account</h1>}
            >
              <SignUpCardDemoBody />
            </Card>
          </div>
        </div>
        <p className="card-surface-matrix__note">
          Layout-only wireframes. Real fields and copy: open the Lit dev login route with Purpose → Sign up.
        </p>
      </div>
    </section>
  );
}

function PageShellCard(): JSX.Element {
  return (
    <section className="card" style={{ gridColumn: "1 / -1" }}>
      <h3>zl-page-shell — Figma 2xl auth frame (6593:141741)</h3>
      <div className="page-shell-frame" data-testid="page-shell-demo">
        <PageShell
          data-embedded
          footer={
            <Pill tone="neutral" href="https://zitadel.com" aria-label="Secured with Zitadel">
              <ZitadelAttributionPillLabel />
            </Pill>
          }
        >
          <Card header={<h1 className="zl-card-title">Sign in</h1>}>
            <SignInCardDemoBody />
          </Card>
        </PageShell>
      </div>
    </section>
  );
}

function IconsCard(): JSX.Element {
  const tones: Array<{ label: string; tone?: IconTone }> = [
    { label: "default" },
    { label: "error", tone: "error" },
    { label: "success", tone: "success" },
    { label: "disabled", tone: "disabled" },
  ];

  return (
    <section className="card" style={{ gridColumn: "1 / -1" }}>
      <h3>Icon — Figma Icons set (4103:10466) × auth glyphs</h3>
      <div className="scope">
        <div className="icon-matrix" data-testid="icon-matrix">
          <div className="icon-matrix__head">
            <span className="row-header">Size</span>
            {GLYPHS.map((name) => (
              <span key={name} className="col-header">
                {name}
              </span>
            ))}
          </div>
          {(["16", "24"] as const).map((size) => (
            <div key={size} className="icon-matrix__row">
              <span className="row-header">{size}px</span>
              {GLYPHS.map((name) => (
                <div key={name} className="icon-matrix__cell">
                  <Icon name={name} size={size} spin={name === "spinner"} decorative />
                </div>
              ))}
            </div>
          ))}
          <div className="icon-matrix__tones-section">
            <span className="group-header">Semantic tones · alert-circle · 24px</span>
            <div className="icon-matrix__tones">
              {tones.map((t) => (
                <div key={t.label} className="icon-matrix__tone">
                  <span className="tone-label">{t.label}</span>
                  <div className="icon-matrix__cell">
                    <Icon name="alert-circle" size="24" tone={t.tone} decorative />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function AtomPlayground(): JSX.Element {
  return (
    <div className="grid" data-testid="atom-playground">
      <FieldsCard />
      <ButtonsCard />
      <AlertsCard />
      <PillsCard />
      <IconsCard />
      <CardsCard />
      <PageShellCard />
    </div>
  );
}
