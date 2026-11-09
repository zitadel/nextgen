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
  type Credential,
  type CredentialVariable,
  type GivenSettings,
  type LookupOptions,
  type SsoOptions,
  type StoredSettings,
  type UnusedConnection,
} from "@/lib/zitadel/resources/connections/types";
