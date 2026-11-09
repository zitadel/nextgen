/**
 * Identity-provider connections under `.zitadel/idps/`, and offering them as a way to sign in.
 */
export {
  CONNECTION_SCHEMA_REF,
  Connection,
  type ClaimRow,
  type CredentialNames,
  type VariableUse,
} from "@/lib/zitadel/connections/connection";
export type { ConnectionSetting, LookupOptions } from "@/lib/zitadel/connections/lookup";
export type { SsoOptions } from "@/lib/zitadel/connections/sso";
