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
 *
 * A page can hold fewer events than asked for, or none, and still carry a
 * token: the server reads a bounded number of events a request, and filters
 * no single index holds are matched over those. Only a page without a token
 * is the end.
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

/**
 * The project's newest audit events, at most `limit`: the sign-ins and changes,
 * as Logs' default view lists them. The audit view is one range of an index,
 * so the page fills up to `limit` whenever the project has that many.
 */
export async function listRecentEvents(projectId: string, limit: number): Promise<LogEvent[]> {
  const answer = await api.listEvents({
    project_id: projectId,
    ...eventsQuery({ view: "audit" }),
    limit,
  });
  return answer.data;
}
