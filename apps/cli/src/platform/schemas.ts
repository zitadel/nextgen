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

export type CreateSchemaResponse = {
  id: string;
};

export type CreateFlowDefinitionResponse = {
  id: string;
};
