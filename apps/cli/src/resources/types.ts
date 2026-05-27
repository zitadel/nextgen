export type ResourceKind = "app";

export const RESOURCE_DIRECTORIES: Record<ResourceKind, string> = {
  app: ".zitadel/apps",
};

export function isValidSlug(value: string): boolean {
  return /^[a-z][a-z0-9-]{0,39}$/.test(value);
}
