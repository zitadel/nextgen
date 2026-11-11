import { useEffect, useRef, useState } from "react";

import { describeError } from "@/lib/api-error";

import { listNewerEvents } from "./api";
import type { LogEvent, LogsSearch } from "./model";

/** How often Live asks for newer events. */
export const LIVE_INTERVAL_MS = 3000;

/**
 * Whether Live was left on. A new filter reads the list again under a new
 * route match, which mounts the screen afresh: Live stays on across it, as it
 * does in Vercel's Logs, until it is turned off or fails.
 */
let wanted = false;

/** Where Live reads from next: a moment, and the token of a read not finished yet. */
interface Cursor {
  createdAfter: string;
  pageToken?: string;
}

/**
 * Live: the events recorded after the list loaded, read every few seconds
 * while it is on and the tab is in view, newest first, for the list to draw
 * above its own rows.
 *
 * Each read is one range of the list's index, oldest first, from the newest
 * event seen so far (`created_after` is inclusive, so the ids already held are
 * dropped). A read that comes back with a token, because more arrived than a
 * page holds or the server stopped at its scan budget, is continued on the
 * next tick before reading from a newer moment, so nothing in between is
 * skipped.
 *
 * `loaded` is the list's generation, as `useLoadMore` takes it: a new load (a
 * filter, Refresh) starts over from its newest event, and what Live held is
 * dropped with the rest of the old list. An event committed after a later one
 * was already read can be missed; Refresh reads the list whole again.
 */
export function useLiveEvents({
  projectId,
  search,
  loaded,
  newest,
  enabled = true,
}: {
  projectId: string;
  search: LogsSearch;
  loaded: unknown;
  /** The newest event the list holds, where Live starts reading. */
  newest: LogEvent | undefined;
  /** Whether the list can have newer events at all: a range that has ended cannot. */
  enabled?: boolean;
}) {
  const [on, setOnState] = useState(wanted);
  const setOn = (next: boolean | ((current: boolean) => boolean)) =>
    setOnState((current) => {
      wanted = typeof next === "function" ? next(current) : next;
      return wanted;
    });
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  // When Live last finished a read: what the screen says it is up to date with.
  const [checkedAt, setCheckedAt] = useState<Date | undefined>(undefined);
  const seen = useRef(new Set<string>());
  const cursor = useRef<Cursor | undefined>(undefined);
  // The filters of the list on screen, read at each tick: a new list resets
  // the cursor below, and the reads carry on under its filters.
  const filters = useRef(search);
  filters.current = search;
  const generation = useRef(loaded);
  generation.current = loaded;

  // A new list: start over from its newest event, or from a minute back when
  // it holds none, since the browser's clock may run ahead of the server's.
  // Keyed on `loaded` alone: `newest` belongs to it, and reading it again for
  // the same list would move the cursor back while Live is ahead of it.
  useEffect(() => {
    setEvents([]);
    setError(undefined);
    seen.current = new Set(newest ? [newest.id] : []);
    cursor.current = {
      createdAfter: newest?.created_at ?? new Date(Date.now() - 60_000).toISOString(),
    };
  }, [loaded]);

  const reading = on && enabled;
  useEffect(() => {
    if (!reading) {
      setCheckedAt(undefined);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      timer = undefined;
      const from = cursor.current;
      if (stopped || !from) return;
      if (document.visibilityState === "hidden") {
        schedule();
        return;
      }
      const list = generation.current;
      try {
        const page = await listNewerEvents(projectId, filters.current, from);
        if (stopped) return;
        // The list was read again meanwhile: this page belongs to the old one.
        if (generation.current !== list) {
          schedule();
          return;
        }
        const fresh = page.items.filter((event) => !seen.current.has(event.id));
        for (const event of fresh) seen.current.add(event.id);
        if (fresh.length > 0) setEvents((current) => [...fresh.reverse(), ...current]);
        const last = page.items.at(-1);
        cursor.current = page.nextPageToken
          ? { createdAfter: from.createdAfter, pageToken: page.nextPageToken }
          : { createdAfter: last?.created_at ?? from.createdAfter };
        setError(undefined);
        setCheckedAt(new Date());
        schedule();
      } catch (cause) {
        if (stopped) return;
        setError(describeError(cause, "Live stopped: could not read newer events."));
        setOn(false);
      }
    }

    function schedule() {
      if (!stopped) timer = setTimeout(() => void tick(), LIVE_INTERVAL_MS);
    }

    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [reading, projectId]);

  return {
    on: reading,
    /** The events Live read, newest first. */
    events,
    /** When the last read finished; none before the first while Live is on, or while it is off. */
    checkedAt,
    error,
    toggle: () => {
      setError(undefined);
      setOn((current) => !current);
    },
  };
}

/** Turns Live off between specs, which share this module. */
export function _resetLiveForTesting(): void {
  wanted = false;
}
