// Tests build values the parsers would produce, for inputs they already know are valid.
// Not exported from the package.
import type {
  ClientIdVariable,
  ClientSecretVariable,
  ConnectionSlug,
  DisplayName,
  Issuer,
} from "./types.js";

export const slug = (value: string) => value as ConnectionSlug;
export const displayName = (value: string) => value as DisplayName;
export const issuer = (value: string) => value as Issuer;
export const idVariable = (value: string) => value as ClientIdVariable;
export const secretVariable = (value: string) => value as ClientSecretVariable;
