export type ResourceKind = "idp" | "app";

export const RESOURCE_DIRECTORIES: Record<ResourceKind, string> = {
  idp: ".zitadel/idps",
  app: ".zitadel/apps",
};

export type ResourceHeader = {
  version: 1;
  kind: ResourceKind;
  slug: string;
  display_name: string;
  enabled: boolean;
};

export function isValidSlug(value: string): boolean {
  return /^[a-z][a-z0-9-]{0,39}$/.test(value);
}
