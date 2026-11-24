import { api } from "@/api/zitadel";
import type { BrandingRevision } from "./branding-palette";

/**
 * The project's newest branding revision, what visitors see today. The list
 * carries ids only, so the configuration is a second call; a project that has
 * never published branding has none.
 */
export async function fetchLatestBranding(
  projectId: string,
): Promise<BrandingRevision | undefined> {
  const revisions = await api.listBranding({ project_id: projectId, limit: 1 });
  const latest = revisions.branding[0];
  if (!latest) return undefined;
  const found = await api.getBranding(latest.id);
  return found.branding as BrandingRevision;
}
