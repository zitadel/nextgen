import {
  type EventPage,
  type EventTimeline,
  getProjectEvent,
  listFlowEvents,
  listProjectEvents,
  listRequestEvents,
} from "./api";
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

/**
 * What the drawer over a list shows: the event, and the events of its login
 * flow when it is part of one, else of its request when one made it.
 */
export interface EventLoad {
  event: ProjectEvent;
  request?: EventTimeline;
  flow?: EventTimeline;
}

/**
 * Reads one event of a project for the drawer, then the other events of its
 * login flow, or else of its request, oldest first. A flow's events hold its
 * requests', so the drawer draws one or the other. An id the project does not
 * hold is a 404.
 */
export async function loadEvent(projectId: string, eventId: string): Promise<EventLoad> {
  const event = await getProjectEvent(projectId, eventId);
  if (event.flow_id) {
    return { event, flow: await listFlowEvents(projectId, event.flow_id) };
  }
  const request = event.request_id
    ? await listRequestEvents(projectId, event.request_id)
    : undefined;
  return { event, request };
}
