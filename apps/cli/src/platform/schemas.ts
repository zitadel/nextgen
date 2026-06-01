import { z } from "zod";

export const environmentSchema = z.enum(["development", "preview", "production"]);
export type ZitadelEnvironment = z.infer<typeof environmentSchema>;

export const serverSchema = z.union([z.literal("mock"), z.string().url()]);
export type ZitadelServer = z.infer<typeof serverSchema>;

export const projectLifecycleSchema = z.enum(["unclaimed", "claimed"]);
export type ProjectLifecycle = z.infer<typeof projectLifecycleSchema>;

export const claimRequiredEnvironmentSchema = z.enum(["preview", "production"]);
export type ClaimRequiredEnvironment = z.infer<typeof claimRequiredEnvironmentSchema>;

export const createProjectRequestSchema = z.object({
  preview_origins: z.array(z.string()).default([]),
  slug_preference: z.string().optional(),
  client_metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const createProjectResponseSchema = z.object({
  project_id: z.string(),
  project_secret: z.string(),
  preview_secret: z.string(),
  preview_origins: z.array(z.string()),
  lifecycle: projectLifecycleSchema,
  claim_required_for: z.array(claimRequiredEnvironmentSchema),
  created_at: z.string(),
  scratch_dashboard_url: z.string().optional(),
});
export type CreateProjectResponse = z.infer<typeof createProjectResponseSchema>;

export const projectResponseSchema = z.object({
  project_id: z.string(),
  lifecycle: projectLifecycleSchema,
  preview_origins: z.array(z.string()),
  claim_required_for: z.array(claimRequiredEnvironmentSchema),
  team_id: z.string().optional(),
  tier: z.enum(["free", "pro", "enterprise"]).optional(),
  created_at: z.string(),
  updated_at: z.string(),
  claimed_at: z.string().optional(),
});
export type GetProjectResponse = z.infer<typeof projectResponseSchema>;

export const applyProjectConfigResponseSchema = z.object({
  project_id: z.string(),
  environment: environmentSchema,
  lifecycle: projectLifecycleSchema,
  applied_at: z.string(),
});
export type ApplyProjectConfigResponse = z.infer<typeof applyProjectConfigResponseSchema>;

export const initProjectClaimResponseSchema = z.object({
  project_id: z.string(),
  challenge_id: z.string(),
  claim_url: z.string(),
  expires_at: z.string(),
  status: z.literal("pending"),
});
export type InitProjectClaimResponse = z.infer<typeof initProjectClaimResponseSchema>;

export const getProjectClaimStatusResponseSchema = z.object({
  project_id: z.string(),
  challenge_id: z.string(),
  status: z.enum(["pending", "completed"]),
  expires_at: z.string(),
  claimed_at: z.string().optional(),
  rotated_project_secret: z.string().optional(),
});
export type GetProjectClaimStatusResponse = z.infer<typeof getProjectClaimStatusResponseSchema>;

export type CreateSchemaResponse = {
  id: string;
};

export type CreateFlowDefinitionResponse = {
  id: string;
};
