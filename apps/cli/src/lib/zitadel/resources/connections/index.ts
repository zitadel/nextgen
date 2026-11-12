/**
 * Identity-provider connections under `.zitadel/idps/`, and offering them as a
 * way to sign in.
 */
export { Connections } from "@/lib/zitadel/resources/connections/collection";
export { Connection } from "@/lib/zitadel/resources/connections/connection";
export {
  CONNECTION_SCHEMA_REF,
  type ClaimRow,
  type ConnectionCredentials,
  type ConnectionPath,
  type ConnectionSetting,
  type ConnectionSummary,
  type Credential,
  type CredentialVariable,
  type LookupOptions,
  type SsoOptions,
  type UnmappedProperty,
  type UnusedConnection,
} from "@/lib/zitadel/resources/connections/types";
