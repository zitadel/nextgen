import { z } from "zod";

export const environmentSchema = z.enum(["development", "preview", "production"]);
export type ZitadelEnvironment = z.infer<typeof environmentSchema>;

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
