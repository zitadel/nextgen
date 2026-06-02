import { z } from "zod";

/**
 * CLI-side deployment environment. Not an API model — it gates which
 * `zitadel.json` environment block and server the commands target.
 * Project request/response shapes live in `@zitadel/api-client`
 * (generated from the OpenAPI spec).
 */
export const environmentSchema = z.enum(["development", "preview", "production"]);
