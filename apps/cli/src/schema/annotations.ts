import { z } from "zod";

export const authMethodSchema = z.object({
  enabled: z.boolean(),
  position: z.number().int().nonnegative(),
});

export const authMethodsSchema = z.record(authMethodSchema);

export const schemaFieldAnnotationSchema = z.object({
  "x-identifier": z.boolean().optional(),
  "x-verify": z.enum(["email"]).optional(),
  "x-mfa": z.enum(["sms"]).optional(),
  "x-sensitive": z.boolean().optional(),
  "x-editable": z.boolean().optional(),
  "x-unique": z.enum(["project"]).optional(),
  "x-claim": z.string().optional(),
});

export type AuthMethods = z.infer<typeof authMethodsSchema>;
