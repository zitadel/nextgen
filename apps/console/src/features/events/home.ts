import { type LinkProps, useMatch } from "@tanstack/react-router";

import { type EventsSearch, parseEventsSearch } from "./model";

/**
 * Where an Events list lives: a project's (`/events`), or the root's, the
 * reserved platform project's (`/platform/events`, D41). The two are one
 * screen on two routes, so the list, the drawer over it, the search and the
 * sidebar's views and filters all link through this and stay on their own.
 */
export type EventsHome = "/events" | "/platform/events";

/** Where one of an events list's links leads. */
export type EventLink = Pick<LinkProps, "to" | "params" | "search">;

/** Where an events list's links lead. */
export interface EventLinks {
  /** An event of the list, open in the drawer over it, under the list's filters. */
  event: (eventId: string) => EventLink;
  /** The list with no event open: where the drawer closes to. */
  list: EventLink;
  /** The list under other filters: what a row's menu and Related events narrow it to. */
  filtered: (search: EventsSearch) => EventLink;
}

/** The links of the list at `home`, under the filters `search`. */
export function eventLinks(home: EventsHome, search: EventsSearch): EventLinks {
  return {
    event: (eventId) => ({
      to: home === "/events" ? "/events/$eventId" : "/platform/events/$eventId",
      params: { eventId },
      search,
    }),
    list: { to: home, search },
    filtered: (next) => ({ to: home, search: next }),
  };
}

const NO_FILTERS = parseEventsSearch({});

/**
 * The Events list the screen is on, or under an event's drawer, and the
 * filters it is under: a project's unless the route is the root's, and the
 * default filters away from a list.
 */
export function useEventsHome(): { home: EventsHome; current: EventsSearch } {
  const project = useMatch({ from: "/_authed/events", shouldThrow: false });
  const root = useMatch({ from: "/_authed/platform/events", shouldThrow: false });
  const list = root ?? project;
  return { home: root ? "/platform/events" : "/events", current: list ? list.search : NO_FILTERS };
}
