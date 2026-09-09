import {
  CreateBrandingBody,
  CreateFlowDefinitionBody,
  CreateSchemaBody,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { z } from "zod";

import {
  isBrandingColor,
  isBrandingFontFamily,
  MAX_BRANDING_URL_LENGTH,
} from "./branding-css.js";
import { isCanonicalLoopbackHttpUrl } from "./branding-url.js";

export const schemaConfigSchema = CreateSchemaBody;
export const flowConfigSchema = CreateFlowDefinitionBody.shape.flow_definition;
export const createFlowDefinitionRequestSchema = CreateFlowDefinitionBody;

/** The wire shape of a branding revision (`POST /branding` request body). */
export const brandingWireSchema = CreateBrandingBody;

/**
 * The local `.zitadel/branding/*.json` dialect: the wire shape plus
 * `liquid_template_file`, a descriptor-relative path the CLI inlines into
 * `liquid_template` when publishing. Exactly one of the two template carriers
 * may be present (the meta-schema `branding.json` mirrors this).
 */
export const brandingConfigSchema = z
  .strictObject({
    // Strict, unlike the generated wire schema: a typo like `hero_urll`
    // must fail plan, not silently pass, get ignored by the server, and
    // vanish on canonical write-back. The editor meta-schema already
    // rejects unknown keys; the CLI gate has to agree.
    ...CreateBrandingBody.shape,
    // Raw strings instead of the generated uri fields: those trim and
    // normalize before refinement runs, hiding exactly the forms the wire
    // body still carries verbatim and Go's url.Parse rejects.
    logo_url: z.string().optional(),
    hero_url: z.string().optional(),
    $schema: z.string().optional(),
    liquid_template_file: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.liquid_template !== undefined && value.liquid_template_file !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Use either liquid_template_file or an inline liquid_template, not both.",
      });
    }
    // A stylesheet alone names no face to render in, so the server rejects the
    // pair as a pair (validateBrandingFontURL in
    // internal/domain/branding_validator.go). plan has to agree, or apply
    // fails after schemas and flows have already been written.
    validateBrandingAssetUrl(value.typography?.font_url, "typography.font_url", ctx, {
      loopback: false,
    });
    if (value.typography?.font_url !== undefined && value.typography.font_family === undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          "typography.font_url needs a typography.font_family to load; a stylesheet alone names no face to render in.",
      });
    }
    // Mirror the server's asset URL gate (validateBrandingAssetURL in
    // internal/domain/branding_validator.go) so plan rejects what apply would.
    // Apply mutates schemas and flows before branding, so a late 400 here would
    // leave a half-applied run.
    validateBrandingAssetUrl(value.logo_url, "logo_url", ctx);
    validateBrandingAssetUrl(value.hero_url, "hero_url", ctx);
    validateBrandingAssetUrl(value.theme?.light?.logo_url, "theme.light.logo_url", ctx);
    validateBrandingAssetUrl(value.theme?.dark?.logo_url, "theme.dark.logo_url", ctx);
    // The appearance values land in a CSS declaration, so the server stores
    // only forms it recognises (ValidateBrandingColor / ValidateBrandingFontFamily
    // in internal/domain/branding_css.go).
    validateBrandingPalette(value.theme?.light?.palette, "theme.light", ctx);
    validateBrandingPalette(value.theme?.dark?.palette, "theme.dark", ctx);
    if (value.typography?.font_family !== undefined && !isBrandingFontFamily(value.typography.font_family)) {
      ctx.addIssue({
        code: "custom",
        message:
          'typography.font_family must be comma-separated font names, each an identifier (Inter, ui-sans-serif) or a quoted name ("APK Futural").',
      });
    }
  });

function validateBrandingPalette(
  palette: Record<string, unknown> | undefined,
  side: string,
  ctx: z.RefinementCtx,
): void {
  if (!palette) {
    return;
  }
  for (const [key, colour] of Object.entries(palette)) {
    // A non-string never reaches here: the generated object schema types every
    // palette value as a string, and Zod skips refinements once the base parse
    // has failed. The check is what narrows `unknown` for the call below.
    if (typeof colour !== "string") {
      continue;
    }
    if (isBrandingColor(colour)) {
      continue;
    }
    ctx.addIssue({
      code: "custom",
      message: `${side}.palette.${key} must be hex (#4F46E5), a CSS colour name, or a colour function such as rgb(), hsl() or oklch().`,
    });
  }
}

function validateBrandingAssetUrl(
  value: string | undefined,
  field: string,
  ctx: z.RefinementCtx,
  options: { loopback?: boolean } = {},
): void {
  if (value === undefined || value === "") {
    return;
  }
  if (value.length > MAX_BRANDING_URL_LENGTH) {
    ctx.addIssue({
      code: "custom",
      message: `${field} must be at most ${MAX_BRANDING_URL_LENGTH} characters.`,
    });
    return;
  }
  // Stricter-or-equal than the Go gate (validateBrandingAssetURL): the WHATWG
  // parser forgives what Go's url.Parse rejects — `https:example.com`,
  // backslashes, and whitespace all get silently normalized. plan must never
  // accept what apply would reject (the reverse is harmless), so reject the
  // raw forms before parsing.
  if (/[\s\\]/.test(value)) {
    ctx.addIssue({ code: "custom", message: `${field} is not a valid URL.` });
    return;
  }
  if (!/^https?:\/\//i.test(value)) {
    ctx.addIssue({ code: "custom", message: `${field} must be an absolute https URL.` });
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    ctx.addIssue({ code: "custom", message: `${field} is not a valid URL.` });
    return;
  }
  // Fetched by every visitor's browser, so userinfo in it is a credential in
  // every access log — the server refuses it and so must plan.
  if (parsed.username !== "" || parsed.password !== "") {
    ctx.addIssue({
      code: "custom",
      message: `${field} must not carry credentials; the URL is fetched by every visitor's browser.`,
    });
    return;
  }
  // Loopback HTTP is the dev-posture carve-out (assets served from the app's
  // own dev server), and it covers images only: a stylesheet is styling rather
  // than an image, so it stays https everywhere. Check the raw URL so WHATWG
  // normalisation cannot make plan accept a host spelling that the Go save
  // gate rejects.
  if (options.loopback !== false && parsed.protocol === "http:" && isCanonicalLoopbackHttpUrl(value)) {
    return;
  }
  if (parsed.protocol !== "https:" || parsed.host === "") {
    ctx.addIssue({
      code: "custom",
      message: `${field} must be an absolute https URL (http is allowed for canonical loopback development hosts only).`,
    });
  }
}
