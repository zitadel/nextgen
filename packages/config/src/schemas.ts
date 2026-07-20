import { z } from "zod";

import {
  CreateBrandingBody,
  CreateFlowDefinitionBody,
  CreateSchemaBody,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";

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
export const brandingConfigSchema = CreateBrandingBody.extend({
  liquid_template_file: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  if (value.liquid_template !== undefined && value.liquid_template_file !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: "Use either liquid_template_file or an inline liquid_template, not both.",
    });
  }
  // font_url is read-only in v1: the login component loads it as a
  // document-level stylesheet (shadow-scoped @font-face never registers
  // faces), which would give branding.write arbitrary CSS over the embedding
  // page. The server rejects it too; safe delivery is an ADR 037 follow-up.
  if (value.font_url !== undefined) {
    ctx.addIssue({
      code: "custom",
      message:
        "font_url is not writable yet (tenant font delivery needs a safe design, see ADR 037); load fonts from the embedding page instead.",
    });
  }
  // Mirror the server's https-only asset gate (validateBrandingAssetURL in
  // internal/domain/branding_validator.go) so plan rejects what apply would —
  // apply mutates schemas and flows before branding, so a late 400 here
  // would leave a half-applied run.
  requireHttpsUrl(value.logo_url, "logo_url", ctx);
  requireHttpsUrl(value.hero_url, "hero_url", ctx);
});

function requireHttpsUrl(
  value: string | undefined,
  field: "logo_url" | "hero_url",
  ctx: z.RefinementCtx,
): void {
  if (value === undefined || value === "") {
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    ctx.addIssue({ code: "custom", message: `${field} is not a valid URL.` });
    return;
  }
  if (parsed.protocol !== "https:" || parsed.host === "") {
    ctx.addIssue({ code: "custom", message: `${field} must be an absolute https URL.` });
  }
}
