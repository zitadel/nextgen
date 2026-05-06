/**
 * Orchestrator runtime types.
 *
 * These mirror the structures the flow engine emits (see
 * `docs/design/flowengine/flow-engine-nodes.md`,
 * `docs/design/flowengine/flow-engine-guide.md`,
 * `docs/design/branding/schema.md`). The shapes are intentionally narrow and
 * permissive — the orchestrator doesn't validate the full step schema, it
 * just needs enough structure to drive the Liquid render pipeline.
 *
 * The full canonical types will land via Vitor's `@zitadel-nextgen/api`
 * package; this file is a frontend-side stand-in until then.
 */

export type FlowFieldType = "text" | "email" | "password" | "tel" | "url" | "number" | "code";

export type FlowField = {
  type: FlowFieldType;
  text_key: string;
  required?: boolean;
  value?: string;
  autocomplete?: string;
  pattern?: string;
};

export type FlowAction = {
  text_key: string;
  primary?: boolean;
  kind?: string;
};

export type FlowGate = {
  provider?: string;
  config?: Record<string, unknown>;
};

export type FlowSsoProvider = {
  id: string;
  name: string;
  template?: string;
};

export type FlowMessage = {
  level: "info" | "warning";
  text_key: string;
};

export type FlowError = {
  code?: string;
  text_key?: string;
  message?: string;
};

export type FlowIdentity = {
  display_name?: string;
  avatar_url?: string;
};

export type FlowStep = {
  name: string;
  type: string;
  texts?: {
    title_key?: string;
    description_key?: string;
  };
  fields?: Record<string, FlowField>;
  actions?: Record<string, FlowAction>;
  gates?: Record<string, FlowGate>;
  sso_providers?: readonly FlowSsoProvider[];
  messages?: readonly FlowMessage[];
  errors?: readonly FlowError[];
  identity?: FlowIdentity | null;
};

export type FlowLayout = "centered" | "split";

export type BrandingPalette = {
  primary?: string;
  on_primary?: string;
  background?: string;
  surface?: string;
  muted?: string;
  border?: string;
  text?: string;
  text_muted?: string;
  link?: string;
  success?: string;
  warning?: string;
  error?: string;
};

export type BrandingTypography = {
  font_family?: string;
  font_family_mono?: string;
  scale?: number;
};

export type BrandingShape = {
  radius?: "none" | "sm" | "md" | "lg" | "full";
  density?: "compact" | "regular" | "comfortable";
};

export type BrandingTheme = {
  mode?: "light" | "dark" | "auto";
  dark?: {
    palette?: BrandingPalette;
  };
};

export type BrandingAssets = {
  logo_dark?: string | null;
  favicon?: string | null;
  background_image?: string | null;
};

export type Branding = {
  layout?: FlowLayout;
  liquid_template?: string | null;
  logo_url?: string | null;
  font_url?: string | null;
  hero_url?: string | null;
  palette?: BrandingPalette;
  typography?: BrandingTypography;
  shape?: BrandingShape;
  assets?: BrandingAssets;
  theme?: BrandingTheme;
};

export type FlowResponse = {
  session_id: string;
  session_token: string;
  step: FlowStep;
  branding?: Branding;
};

export type FlowSubmitInput = {
  session_id: string;
  session_token: string;
  payload: Record<string, unknown>;
};
