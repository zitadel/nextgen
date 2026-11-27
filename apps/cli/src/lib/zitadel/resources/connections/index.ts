/**
 * Identity-provider connections under `.zitadel/idps/`, and offering them as a
 * way to sign in.
 */
export { Connections } from "@/lib/zitadel/resources/connections/collection";
export { Connection } from "@/lib/zitadel/resources/connections/connection";
export type {
  ConnectionSetting,
  Credential,
  SsoOptions,
} from "@/lib/zitadel/resources/connections/types";
