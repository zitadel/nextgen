import { z } from "zod";

/**
 * CLI-side deployment environment. Not an API model — it gates which
 * `zitadel.json` environment block and server the commands target.
 * Project request/response shapes live in `@zitadel-nextgen/api`
 * (generated from the OpenAPI spec); see `api/client.ts`.
 */
export const environmentSchema = z.enum(["development", "preview", "production"]);

/**
 * The static type for a validated environment, inferred from
 * {@link environmentSchema} so the literal union and the runtime
 * validator can never drift apart.
 */
export type ZitadelEnvironment = z.infer<typeof environmentSchema>;
