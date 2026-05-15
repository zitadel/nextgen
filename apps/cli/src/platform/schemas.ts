import { z } from "zod";

export const environmentSchema = z.enum(["development", "preview", "production"]);
export type ZitadelEnvironment = z.infer<typeof environmentSchema>;

export const serverSchema = z.union([z.literal("mock"), z.string().url()]);
export type ZitadelServer = z.infer<typeof serverSchema>;

export const createProjectRequestSchema = z.object({
  previewOrigins: z.array(z.string()).default([]),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const createProjectResponseSchema = z.object({
  id: z.string(),
  projectSecret: z.string(),
  previewSecret: z.string(),
  previewOrigins: z.array(z.string()),
  createdAt: z.string(),
});
export type CreateProjectResponse = z.infer<typeof createProjectResponseSchema>;

export const projectResponseSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GetProjectResponse = z.infer<typeof projectResponseSchema>;

export const configUploadRequestSchema = z.object({
  config: z.record(z.string(), z.unknown()),
  resources: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  templates: z.record(z.string(), z.string()).optional(),
  hash: z.string(),
  schema_version: z.string().optional(),
  sdk_version: z.string().optional(),
  ejected_renderer_pin: z.string().optional(),
});
export type UploadConfigRequest = z.infer<typeof configUploadRequestSchema>;

export const serverCapabilitiesSchema = z.object({
  schema_version: z.string(),
  flow_protocol_version: z.string(),
  step_types: z.array(z.string()),
  idp_types: z.array(z.string()),
  delivery_modes: z.array(z.string()),
  renderer_modes: z.array(z.string()),
  features: z.array(z.string()).default([]),
});
export type ServerCapabilities = z.infer<typeof serverCapabilitiesSchema>;

export const configWarningSchema = z.object({
  code: z.string(),
  path: z.string(),
  message: z.string(),
  severity: z.enum(["info", "warning", "error"]).default("warning"),
});
export type ConfigWarning = z.infer<typeof configWarningSchema>;

export const configUploadResponseSchema = z.object({
  config_version: z.number(),
  hash: z.string(),
  applied_at: z.string(),
  server_capabilities: serverCapabilitiesSchema,
  warnings: z.array(configWarningSchema).default([]),
});
export type UploadConfigResponse = z.infer<typeof configUploadResponseSchema>;

export const initClaimRequestSchema = z.object({
  suggested_team_name: z.string().optional(),
});
export type InitClaimRequest = z.infer<typeof initClaimRequestSchema>;

export const initClaimResponseSchema = z.object({
  claim_url: z.string().url(),
  challenge_id: z.string(),
  expires_at: z.string(),
});
export type InitClaimResponse = z.infer<typeof initClaimResponseSchema>;

const claimStatusSchema = z
  .enum(["pending", "claimed", "completed", "expired"])
  .transform((value) => {
    return value === "completed" ? "claimed" : value;
  });

export const claimStatusResponseSchema = z.object({
  status: claimStatusSchema,
  new_project_secret: z.string().optional(),
  team_id: z.string().optional(),
  claimed_at: z.string().optional(),
  dashboard_url: z.url().optional(),
  tier: z.enum(["free", "pro", "enterprise"]).optional(),
});
export type ClaimStatusResponse = z.infer<typeof claimStatusResponseSchema>;

export const capabilitiesResponseSchema = z.object({
  mode: z.enum(["mock", "cloud", "server"]),
  version: z.string(),
  features: z.record(z.string(), z.boolean()),
});
export type CapabilitiesResponse = z.infer<typeof capabilitiesResponseSchema>;

export type CreateSchemaResponse = {
  id: string;
};

export type CreateFlowDefinitionResponse = {
  id: string;
};
