import { api } from "@/api/zitadel";
import { readAllPages } from "@/lib/paging";
import type { FlowDefinitionEntry } from "./model";

/** Every login flow in the project, at its latest revision. */
export async function fetchAllFlows(projectId: string): Promise<FlowDefinitionEntry[]> {
  return readAllPages(async (pageToken) => {
    const page = await api.listFlowDefinitions({
      project_id: projectId,
      revisions: "latest",
      limit: 100,
      page_token: pageToken,
    });
    return { items: page.flow_definitions, next: page.next_page_token };
  });
}
