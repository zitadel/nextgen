/**
 * The types of a declared application: what one holds.
 */

import type { applicationConfigSchema } from "@zitadel/config/schemas";

import type { ContractValue } from "@/lib/zitadel/resources/document";

/**
 * What an application holds once the application contract took its body.
 */
export type ApplicationValue = ContractValue<typeof applicationConfigSchema>;
