import { z } from "zod";

export const environmentSchema = z.enum(["development", "preview", "production"]);
export type ZitadelEnvironment = z.infer<typeof environmentSchema>;

export const serverSchema = z.union([z.literal("mock"), z.string().url()]);
export type ZitadelServer = z.infer<typeof serverSchema>;

export const createProjectRequestSchema = z.object({
  preview_origins: z.array(z.string()).default([]),
  slug_preference: z.string().optional(),
  client_metadata: z.record(z.unknown()).optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const createProjectResponseSchema = z.object({
  project_id: z.string(),
  project_secret: z.string(),
  preview_secret: z.string(),
  preview_origins: z.array(z.string()),
  created_at: z.string(),
  scratch_dashboard_url: z.url(),
  schema_version: z.number().default(2),
});
export type CreateProjectResponse = z.infer<typeof createProjectResponseSchema>;

const lifecycleSchema = z.enum(["pre-claim", "claimed", "unclaimed"]).transform((value) => {
  return value === "unclaimed" ? "pre-claim" : value;
});

export const projectResponseSchema = z.object({
  project_id: z.string(),
  lifecycle: lifecycleSchema,
  declared_issuers: z.record(z.unknown()).optional(),
  preview_origins: z.array(z.string()).default([]),
  team_id: z.string().optional(),
  created_at: z.string().optional(),
  claimed_at: z.string().optional(),
  config_hash: z.string().optional(),
  tier: z.enum(["free", "pro", "enterprise"]).optional(),
});
export type GetProjectResponse = z.infer<typeof projectResponseSchema>;

export const configUploadRequestSchema = z.object({
  config: z.record(z.unknown()),
  resources: z.record(z.record(z.unknown())).optional(),
  templates: z.record(z.string()).optional(),
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
  dashboard_url: z.string().url().optional(),
  tier: z.enum(["free", "pro", "enterprise"]).optional(),
});
export type ClaimStatusResponse = z.infer<typeof claimStatusResponseSchema>;

export const capabilitiesResponseSchema = z.object({
  mode: z.enum(["mock", "cloud", "server"]),
  version: z.string(),
  features: z.record(z.boolean()),
});
export type CapabilitiesResponse = z.infer<typeof capabilitiesResponseSchema>;
