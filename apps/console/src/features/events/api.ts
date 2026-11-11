import { api } from "@/api/zitadel";
import { LIST_PAGE_SIZE } from "@/lib/paging";

import { eventsQuery, type LogEvent, type LogsSearch } from "./model";

/** One page of a project's events, newest first. */
interface EventPage {
  items: LogEvent[];
  nextPageToken?: string;
}

/**
 * A page of the project's events under the list's filters, newest first. A
 * page token continues the filters it was issued under, so `Load more` sends
 * the same ones, `createdAfter` included: the start of the time range, which
 * the list computed once when it loaded. A project that is not claimed yet
 * answers an empty page, except to a platform operator: its events are stored
 * but stay hidden until the claim.
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

/**
 * The events recorded after a moment under the list's filters, oldest first:
 * what Live adds on top of the list. `createdAfter` is inclusive, so the
 * newest event the list holds comes back too, and the caller drops what it
 * has. A token continues the same read; a page without one has read up to
 * now.
 */
export async function listNewerEvents(
  projectId: string,
  search: LogsSearch,
  page: { createdAfter: string; pageToken?: string },
): Promise<EventPage> {
  const query = eventsQuery(search);
  const answer = await api.listEvents({
    project_id: projectId,
    ...query,
    // The later of the two starts: the list's own range may begin after the
    // newest event it holds, when it holds none.
    created_after:
      query.created_after && query.created_after > page.createdAfter
        ? query.created_after
        : page.createdAfter,
    order: "asc",
    limit: LIST_PAGE_SIZE,
    page_token: page.pageToken,
  });
  return { items: answer.data, nextPageToken: answer.next_page_token ?? undefined };
}

/** How many of one request's events its panel lists. */
const REQUEST_EVENTS_LIMIT = 50;

/**
 * One request's events in the order they happened, at most
 * {@link REQUEST_EVENTS_LIMIT}: the API call and the changes and sign-ins it
 * made. One range of the request index; `more` says the request holds others.
 */
export async function listRequestEvents(
  projectId: string,
  requestId: string,
): Promise<{ items: LogEvent[]; more: boolean }> {
  const answer = await api.listEvents({
    project_id: projectId,
    request_id: requestId,
    order: "asc",
    limit: REQUEST_EVENTS_LIMIT,
  });
  return { items: answer.data, more: Boolean(answer.next_page_token) };
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
