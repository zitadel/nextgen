import { api } from "@/api/zitadel";
import type { BrandingRevision } from "@/features/branding/branding-palette";
import { flowDisplayName } from "@/features/flow-definitions/model";

import { type PreviewFlow, successStepName } from "./preview-options";

/** What the Branding screen shows: the newest revision and the flows it previews. */
export interface BrandingData {
  revision: BrandingRevision;
  flows: PreviewFlow[];
}

/**
 * Reads a project's Branding screen: for the selected project's, and for the
 * root's of the reserved platform project (D41), which share it.
 */
export async function loadBranding(projectId: string): Promise<BrandingData> {
  // Newest first, so the head of the list is what visitors see today. The
  // list carries ids only, so the configuration itself is a second call. A
  // project that has never published branding has no revision, and the
  // panel then shows the maintained defaults.
  const [revisions, flows] = await Promise.all([
    api.listBranding({ project_id: projectId }),
    // One row per flow rather than per revision (#1246), as the Login
    // flows directory asks for it. The preview starts a flow by name, so a
    // second revision of one is an ambiguous row rather than another choice.
    api.listFlowDefinitions({ project_id: projectId, revisions: "latest" }),
  ]);
  // The preview runs one of the project's own flows, so the selector lists
  // what it can actually render rather than a fixed set.
  //
  // Each entry carries the purposes it serves. A definition can serve one
  // without the other, and starting a flow for a purpose it does not serve
  // answers `flowdef.purpose_mismatch` rather than a preview.
  const previewFlows: PreviewFlow[] = flows.flow_definitions.map((entry) => ({
    name: entry.flow_definition.name,
    label: flowDisplayName(entry.flow_definition),
    purposes: Object.keys(entry.flow_definition.purposes ?? {}),
    successStep: successStepName(entry.flow_definition.steps),
  }));
  const latest = revisions[0];
  if (!latest) return { revision: {} as BrandingRevision, flows: previewFlows };
  const found = await api.getBrandingById(latest.id);
  return { revision: found.branding as BrandingRevision, flows: previewFlows };
}
