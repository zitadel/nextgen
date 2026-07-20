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
});
