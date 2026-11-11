import { Download, ListFilter } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { copyEvents, downloadEvents } from "../export";
import { filterCount, type ProjectEvent, type EventsSearch, VIEW_LABEL } from "../model";

/** What Events' title row and the line under it hold, beside the search (`EventSearchField`). */

/**
 * The way to the views and filters while the sidebar is an icon rail, on a
 * phone or collapsed: the rail has no room for a field, and without its
 * labels it does not say which view is on. The button names the view and how
 * many filters narrow it, and opens the sidebar, where both are changed.
 * Beside an open sidebar it would repeat it, so it is not drawn.
 */
export function SidebarFilters({ search }: { search: EventsSearch }) {
  const { isMobile, state, setOpen, setOpenMobile } = useSidebar();
  if (!isMobile && state === "expanded") return null;
  const count = filterCount(search);
  const filters = count === 1 ? "1 filter" : `${count} filters`;

  return (
    <Button
      variant="outline"
      className="shrink-0 gap-1.5 px-2.5!"
      aria-label={`Views and filters: ${VIEW_LABEL[search.view]}${count > 0 ? `, ${filters}` : ""}`}
      onClick={() => (isMobile ? setOpenMobile(true) : setOpen(true))}
    >
      <ListFilter aria-hidden />
      {VIEW_LABEL[search.view]}
      {count > 0 && <Badge variant="secondary">{count}</Badge>}
    </Button>
  );
}

/**
 * Live's mark: a dot, grey while it is off, green and pulsing while it reads,
 * as a recording light is. The button's pressed state says the same to
 * assistive tech.
 */
export function LiveDot({ on }: { on: boolean }) {
  return (
    <span aria-hidden className="relative flex size-2">
      {on && (
        <span className="bg-success absolute inline-flex size-full animate-ping rounded-full opacity-75 motion-reduce:animate-none" />
      )}
      <span
        className={cn(
          "relative inline-flex size-2 rounded-full",
          on ? "bg-success" : "bg-muted-foreground/60",
        )}
      />
    </span>
  );
}

/**
 * The line under the toolbar while Live is on: that new events appear at the
 * top, and how long ago it last read, counted every second, so a quiet list
 * still shows that it is being read.
 */
export function LiveStatus({ checkedAt }: { checkedAt: Date | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = checkedAt
    ? Math.max(0, Math.round((now - checkedAt.getTime()) / 1000))
    : undefined;

  return (
    <p role="status" className="text-muted-foreground mt-3 px-0 text-xs lg:px-2">
      Live: new events appear at the top as they are recorded.{" "}
      {seconds === undefined
        ? "Reading…"
        : seconds < 2
          ? "Checked just now."
          : `Checked ${seconds} s ago.`}
    </p>
  );
}

/**
 * The loaded rows copied or saved, as Vercel's Logs offers them: JSON as the
 * API returns each event, or CSV with the payload in one field. Only what the
 * list holds, Live's rows and the pages loaded included.
 */
/** Copies the loaded events and says whether it did, as search's Copy project ID does. */
async function copy(events: ProjectEvent[]) {
  if (await copyEvents(events)) toast.success("Events copied");
  else toast.error("Could not copy the events");
}

export function ExportMenu({ events }: { events: ProjectEvent[] }) {
  const empty = events.length === 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon" className="shrink-0" aria-label="Export">
          <Download aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem disabled={empty} onSelect={() => void copy(events)}>
          Copy loaded events
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={empty} onSelect={() => downloadEvents(events, "json")}>
          Download JSON
        </DropdownMenuItem>
        <DropdownMenuItem disabled={empty} onSelect={() => downloadEvents(events, "csv")}>
          Download CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
