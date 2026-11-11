import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useRef, useState } from "react";

import { IdText } from "@/components/id-text";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

import { type LogsSearch, narrowedBy, type SearchMeaning, searchMeanings } from "../model";

/** What tells the two readings of one id apart. */
const READING: Partial<Record<string, string>> = {
  actor: "what it did",
  resource: "what happened to it",
};

/**
 * The search above the Logs table. It takes one id or one event type and
 * turns it into the filter it names, or opens the event it names
 * (`searchMeanings`): the server matches whole values on indexed fields and
 * has no text search, so nothing here searches as you type.
 *
 * What the term means is listed under the field. One meaning applies on
 * Enter. An id that may be an actor or a resource lists both and waits for a
 * choice: guessing would show an empty list for the other reading.
 */
export function EventSearch({ current }: { current: LogsSearch }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const firstOption = useRef<HTMLButtonElement>(null);
  const meanings = searchMeanings(term);

  function apply(meaning: SearchMeaning) {
    setTerm("");
    setOpen(false);
    if (meaning.kind === "event") {
      void navigate({ to: "/events/$eventId", params: { eventId: meaning.id }, search: current });
    } else {
      void navigate({
        to: "/events",
        search: narrowedBy(current, meaning.filter.key, meaning.value),
      });
    }
  }

  return (
    <Popover open={open && term.trim() !== ""} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <form
          data-event-search
          // On a phone it shares its row with the views button and takes
          // what is left, or the next row when that is under 160px.
          className="relative min-w-40 flex-1 sm:w-64 sm:flex-none lg:w-80"
          onSubmit={(event) => {
            event.preventDefault();
            const [only, ...others] = meanings;
            if (only && others.length === 0) apply(only);
            else setOpen(true);
          }}
        >
          <Search
            aria-hidden
            strokeWidth={1.5}
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && firstOption.current) {
                event.preventDefault();
                firstOption.current.focus();
              }
            }}
            placeholder="Find by ID or event type"
            aria-label="Find events by ID or event type"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="pl-8"
          />
        </form>
      </PopoverAnchor>
      {/* The field keeps the focus: the list under it is read, not entered,
          until an arrow key or a click goes into it. */}
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-64 p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        // A click back into the field is not a click away from it.
        onInteractOutside={(event) => {
          if (event.target instanceof Element && event.target.closest("[data-event-search]")) {
            event.preventDefault();
          }
        }}
      >
        {meanings.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1.5 text-xs">
            Logs are found by one exact ID or event type, such as <code>req_…</code> or{" "}
            <code>user.created</code>. There is no text search.
          </p>
        ) : (
          <>
            {meanings.length > 1 && (
              <p className="text-muted-foreground px-2 py-1.5 text-xs">
                This ID can be either. Choose one:
              </p>
            )}
            <ul className="flex flex-col">
              {meanings.map((meaning, index) => (
                <li key={meaning.kind === "event" ? "event" : meaning.filter.key}>
                  <button
                    ref={index === 0 ? firstOption : undefined}
                    type="button"
                    // The parts sit in a row with no space between them: the
                    // name reads them as the sentence they are.
                    aria-label={meaningName(meaning)}
                    className="hover:bg-accent focus-visible:bg-accent flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none"
                    onClick={() => apply(meaning)}
                  >
                    <Meaning meaning={meaning} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** An option's name: "Actor user_1, what it did". */
function meaningName(meaning: SearchMeaning): string {
  if (meaning.kind === "event") return `Open event ${meaning.id}`;
  const reading = READING[meaning.filter.key];
  return `${meaning.filter.label} ${meaning.value}${reading ? `, ${reading}` : ""}`;
}

/** One meaning as an option: what the term is, the term, and what choosing it shows. */
function Meaning({ meaning }: { meaning: SearchMeaning }) {
  if (meaning.kind === "event") {
    return (
      <>
        <span className="text-muted-foreground shrink-0">Open event</span>
        <IdText id={meaning.id} title={meaning.id} className="text-foreground" />
      </>
    );
  }
  const reading = READING[meaning.filter.key];
  return (
    <>
      <span className="text-muted-foreground shrink-0">{meaning.filter.label}</span>
      <IdText id={meaning.value} title={meaning.value} className="text-foreground" />
      {reading && <span className="text-muted-foreground shrink-0 text-xs">{reading}</span>}
    </>
  );
}
