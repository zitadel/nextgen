import { api } from "@/api/zitadel";
import { LIST_PAGE_SIZE } from "@/lib/paging";

import type { LogEvent } from "./model";

/** One page of a project's events, newest first. */
export interface EventPage {
  items: LogEvent[];
  nextPageToken?: string;
}

/**
 * A page of the project's events, newest first. A project that is not
 * claimed yet answers an empty page: its events are stored but stay hidden
 * until the claim.
 */
export async function listProjectEvents(projectId: string, pageToken?: string): Promise<EventPage> {
  const page = await api.listEvents({
    project_id: projectId,
    limit: LIST_PAGE_SIZE,
    page_token: pageToken,
  });
  return { items: page.data, nextPageToken: page.next_page_token ?? undefined };
}

/** One event of the project. An id the project does not hold is a 404. */
export function getProjectEvent(projectId: string, eventId: string): Promise<LogEvent> {
  return api.getEvent(eventId, { project_id: projectId });
}
