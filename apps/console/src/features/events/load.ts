import { type EventPage, getProjectEvent, listProjectEvents, listRequestEvents } from "./api";
import { type EventsSearch, type ProjectEvent, rangeStart } from "./model";

/**
 * What an events list loads: its first page, with the filters and the start
 * of the time range that page answers. `Load more` continues these, not the
 * ones a newer navigation is on its way to.
 */
export interface EventsLoad extends EventPage {
  search: EventsSearch;
  createdAfter?: string;
}

/**
 * Reads an events list: the selected project's Events, and the root's Audit
 * log of the reserved platform project (D41), which share it. The time range
 * is counted back once, here, and `Load more` keeps it.
 */
export async function loadEvents(projectId: string, search: EventsSearch): Promise<EventsLoad> {
  const createdAfter = rangeStart(search.since, new Date());
  const page = await listProjectEvents(projectId, search, { createdAfter });
  return { ...page, search, createdAfter };
}

/** What the drawer over a list shows: the event, and its request's events when one made it. */
export interface EventLoad {
  event: ProjectEvent;
  request?: { items: ProjectEvent[]; more: boolean };
}

/**
 * Reads one event of a project for the drawer, then the other events of its
 * request, oldest first. An id the project does not hold is a 404.
 */
export async function loadEvent(projectId: string, eventId: string): Promise<EventLoad> {
  const event = await getProjectEvent(projectId, eventId);
  const request = event.request_id
    ? await listRequestEvents(projectId, event.request_id)
    : undefined;
  return { event, request };
}
