/**
 * Identity-provider connections under `.zitadel/idps/`, and offering them as a
 * way to sign in.
 */
export { Connections, type SsoOptions } from "@/lib/zitadel/connections/collection";
export {
  CONNECTION_SCHEMA_REF,
  Connection,
  type ClaimRow,
  type CredentialNames,
  type UnknownField,
  type VariableUse,
} from "@/lib/zitadel/connections/connection";
export type { ConnectionSetting, LookupOptions } from "@/lib/zitadel/connections/lookup";
