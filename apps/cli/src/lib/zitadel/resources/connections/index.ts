/**
 * Identity-provider connections under `.zitadel/idps/`, and offering them as a
 * way to sign in.
 */
export { Connections } from "@/lib/zitadel/resources/connections/collection";
export { Connection } from "@/lib/zitadel/resources/connections/connection";
export {
  CONNECTION_SCHEMA_REF,
  type ClaimRow,
  type ConnectionPath,
  type ConnectionSetting,
  type CredentialNames,
  type CredentialVariable,
  type GivenSettings,
  type LookupOptions,
  type SsoOptions,
  type StoredSettings,
  type UnusedConnection,
  type VariableUse,
} from "@/lib/zitadel/resources/connections/types";
