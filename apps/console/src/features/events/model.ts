import type { ListEvents200DataItem } from "@zitadel/api/generated/model";

/**
 * One event, as `GET /events` and `GET /events/{id}` return it: an
 * append-only record of something that happened in a project, a sign-in
 * step, a change to a record or an API request. The API calls them events;
 * the sidebar calls their screen Logs.
 */
export type LogEvent = ListEvents200DataItem;

/**
 * What an event is about, for the one line a list row has: the request an
 * API call made, or the record a change touched. `undefined` when the event
 * names no record.
 *
 * A request's `route` is the operation it ran (`createUser`): the server
 * records that rather than the path, which would carry resource ids.
 */
export type EventSubject =
  | { kind: "request"; method: string; route: string; status: number }
  | { kind: "record"; type: string; id?: string };

export function eventSubject(event: LogEvent): EventSubject | undefined {
  if (event.event_type === "request.api") {
    const { method, route_template: route, status } = event.payload;
    return { kind: "request", method, route, status };
  }
  if (!event.entity_type) return undefined;
  return { kind: "record", type: event.entity_type, id: event.entity_id || undefined };
}

/** One labelled value of an event's envelope. */
export interface EventField {
  label: string;
  value: string;
  /** An identifier: drawn in the code face, with a copy button. */
  id?: boolean;
}

/**
 * The envelope values an event carries, in reading order: who, through what,
 * on what, and the ids that tie it to other events. A value the event does
 * not carry has no row, since the server stores an unset one as empty or
 * `null` and neither says anything.
 */
export function eventFields(event: LogEvent): EventField[] {
  const fields: (Omit<EventField, "value"> & { value: string | null | undefined })[] = [
    { label: "Category", value: event.category },
    { label: "Actor", value: event.actor_id, id: true },
    { label: "Actor type", value: event.actor_type },
    { label: "Application", value: event.client_id, id: true },
    { label: "Token", value: event.token_id, id: true },
    { label: "Delegation", value: event.delegation_type },
    { label: "Delegation ID", value: event.delegation_id, id: true },
    { label: "Granted by", value: event.grantor, id: true },
    { label: "Resource type", value: event.entity_type },
    { label: "Resource ID", value: event.entity_id, id: true },
    { label: "Team", value: event.team_id, id: true },
    { label: "Request ID", value: event.request_id, id: true },
    { label: "Session ID", value: event.session_id, id: true },
    { label: "Flow ID", value: event.flow_id, id: true },
    { label: "Device", value: event.fingerprint, id: true },
  ];
  return fields.filter((field): field is EventField => Boolean(field.value));
}
