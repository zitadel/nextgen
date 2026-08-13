import {
  CreateBrandingBody,
  CreateFlowDefinitionBody,
  CreateSchemaBody,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { z } from "zod";

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
    // font_url is read-only in v1: the login component loads it as a
    // document-level stylesheet (shadow-scoped @font-face never registers
    // faces), which would give branding.write arbitrary CSS over the embedding
    // page. The server rejects it too; safe delivery is an ADR 040 follow-up.
    if (value.font_url !== undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          "font_url is not writable yet (tenant font delivery needs a safe design, see ADR 040); load fonts from the embedding page instead.",
      });
    }
    // Mirror the server's asset URL gate (validateBrandingAssetURL in
    // internal/domain/branding_validator.go) so plan rejects what apply would.
    // Apply mutates schemas and flows before branding, so a late 400 here would
    // leave a half-applied run.
    validateBrandingAssetUrl(value.logo_url, "logo_url", ctx);
    validateBrandingAssetUrl(value.hero_url, "hero_url", ctx);
  });

function validateBrandingAssetUrl(
  value: string | undefined,
  field: "logo_url" | "hero_url",
  ctx: z.RefinementCtx,
): void {
  if (value === undefined || value === "") {
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
  // Loopback HTTP is the dev-posture carve-out (assets served from the app's
  // own dev server). Check the raw URL so WHATWG normalisation cannot make
  // plan accept a host spelling that the Go save gate rejects.
  if (parsed.protocol === "http:" && isCanonicalLoopbackHttpUrl(value)) {
    return;
  }
  if (parsed.protocol !== "https:" || parsed.host === "") {
    ctx.addIssue({
      code: "custom",
      message: `${field} must be an absolute https URL (http is allowed for canonical loopback development hosts only).`,
    });
  }
}
