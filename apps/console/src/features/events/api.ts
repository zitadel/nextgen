import { api } from "@/api/zitadel";
import { LIST_PAGE_SIZE } from "@/lib/paging";

import { eventsQuery, type LogEvent, type LogsSearch } from "./model";

/** One page of a project's events, newest first. */
export interface EventPage {
  items: LogEvent[];
  nextPageToken?: string;
}

/**
 * A page of the project's events under the list's filters, newest first. A
 * page token continues the filters it was issued under, so `Load more` sends
 * the same ones, `createdAfter` included: the start of the time range, which
 * the list computed once when it loaded. A project that is not claimed yet
 * answers an empty page: its events are stored but stay hidden until the
 * claim.
 */
export async function listProjectEvents(
  projectId: string,
  search: LogsSearch,
  page: { createdAfter?: string; pageToken?: string } = {},
): Promise<EventPage> {
  const answer = await api.listEvents({
    project_id: projectId,
    ...eventsQuery(search, page.createdAfter),
    limit: LIST_PAGE_SIZE,
    page_token: page.pageToken,
  });
  return { items: answer.data, nextPageToken: answer.next_page_token ?? undefined };
}

/** One event of the project. An id the project does not hold is a 404. */
export function getProjectEvent(projectId: string, eventId: string): Promise<LogEvent> {
  return api.getEvent(eventId, { project_id: projectId });
}
