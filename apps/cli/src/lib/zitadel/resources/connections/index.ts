/**
 * Identity-provider connections under `.zitadel/idps/`, and offering them as a
 * way to sign in.
 */
export {
  Connections,
  type SsoOptions,
  type UnusedConnection,
} from "@/lib/zitadel/resources/connections/collection";
export {
  CONNECTION_SCHEMA_REF,
  Connection,
  type ClaimRow,
  type CredentialNames,
  type StoredSettings,
  type VariableUse,
} from "@/lib/zitadel/resources/connections/connection";
export type { ConnectionSetting, LookupOptions } from "@/lib/zitadel/resources/connections/lookup";
