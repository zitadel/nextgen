import { useNavigate } from "@tanstack/react-router";
import { Search, UserRound, X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { IdText } from "@/components/id-text";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

import {
  chipFilters,
  type EventsSearch,
  narrowedBy,
  type SearchMeaning,
  searchMeanings,
  type ValueFilter,
} from "../model";
import { EVENT_SHEET_WIDTH } from "./event-panel";

/** What tells the two readings of one id apart. */
const READING: Partial<Record<string, string>> = {
  actor: "what it did",
  user: "what happened to its account",
  resource: "what happened to it",
};

/** One choice under the field: a meaning of the term, or My activity. */
type Option = { kind: "meaning"; meaning: SearchMeaning } | { kind: "mine" };

/**
 * The search above the Events table, as Vercel's Logs has one: where every value
 * that is pasted rather than chosen narrows the list. The filters it set sit
 * in the field as chips, each with its name, its value and a button that
 * removes it; Backspace in the empty field removes the last.
 *
 * A term is one id, one event type or one API operation, read by its shape,
 * or a filter's name before its value (`actor:user_1`, `resource_type:user`;
 * `searchMeanings`). It becomes the filter it names, or opens the event it
 * names: the server matches whole values on indexed fields and has no text
 * search, so nothing here searches as you type.
 *
 * What the term means is listed under the field. One meaning applies on
 * Enter. An id that may be an actor or a resource, or a user's that may be
 * the account or the actor, lists both and waits for a choice: guessing would
 * show an empty list for the other reading. The empty
 * field offers **My activity**, the list narrowed to what the signed-in
 * person did, whose chip reads `actor: me`.
 */
export function EventSearchField({
  current,
  me,
  besideEvent = false,
}: {
  current: EventsSearch;
  me?: string;
  /**
   * An event is open in its drawer. Where the drawer covers the list's right
   * it covers the field's too, and the list under the field keeps to the part
   * still in view rather than spreading over the drawer.
   */
  besideEvent?: boolean;
}) {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const firstOption = useRef<HTMLButtonElement>(null);
  const chips = chipFilters(current);
  const mine = me !== undefined && current.actor === me;
  const options: Option[] =
    term.trim() === ""
      ? me && !mine
        ? [{ kind: "mine" }]
        : []
      : searchMeanings(term).map((meaning) => ({ kind: "meaning", meaning }));

  function go(search: EventsSearch) {
    void navigate({ to: "/events", search });
  }

  function choose(option: Option) {
    setTerm("");
    setOpen(false);
    if (option.kind === "mine") {
      if (me) go(narrowedBy(current, "actor", me));
      return;
    }
    const { meaning } = option;
    if (meaning.kind === "event") {
      void navigate({ to: "/events/$eventId", params: { eventId: meaning.id }, search: current });
    } else {
      go(narrowedBy(current, meaning.filter.key, meaning.value));
    }
  }

  function remove(filter: ValueFilter) {
    go(narrowedBy(current, filter.key, undefined));
    field.current?.focus();
  }

  return (
    <Popover open={open && (term.trim() !== "" || options.length > 0)} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <form
          data-event-search
          // The toolbar's widest control, as Vercel's search is: it takes
          // what the row leaves, and its chips wrap within it.
          className="flex min-w-48 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            const [only, ...others] = options;
            if (only && others.length === 0 && term.trim() !== "") choose(only);
            else setOpen(true);
          }}
        >
          {/* A label, so a click anywhere in the box but on a chip's button
              puts the caret in the field. */}
          <label className="border-input bg-background focus-within:border-ring focus-within:ring-ring/50 dark:bg-input/30 flex min-h-9 flex-1 cursor-text flex-wrap items-center gap-1 rounded-md border py-1 pr-1 pl-2.5 shadow-xs focus-within:ring-[3px]">
            <Search
              aria-hidden
              strokeWidth={1.5}
              className="text-muted-foreground pointer-events-none size-4 shrink-0"
            />
            {chips.length > 0 && (
              <ul aria-label="Search filters" className="contents">
                {chips.map(({ filter, value }) => (
                  <li key={filter.key} className="contents">
                    <Chip
                      name={filter.prefix}
                      value={filter.key === "actor" && value === me ? "me" : value}
                      onRemove={() => remove(filter)}
                      removeLabel={`Remove the ${filter.name} filter`}
                    />
                  </li>
                ))}
              </ul>
            )}
            <input
              ref={field}
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
                const last = chips.at(-1);
                if (event.key === "Backspace" && term === "" && last) {
                  event.preventDefault();
                  remove(last.filter);
                }
              }}
              placeholder={
                chips.length > 0 ? "Add a filter" : "Search by ID, event type or operation"
              }
              aria-label="Search events by ID, event type or operation"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="placeholder:text-muted-foreground h-7 min-w-32 flex-1 bg-transparent text-sm outline-none [&::-webkit-search-cancel-button]:hidden"
            />
          </label>
        </form>
      </PopoverAnchor>
      {/* The field keeps the focus: the list under it is read, not entered,
          until an arrow key or a click goes into it. */}
      <PopoverContent
        align="start"
        // As wide as the field, up to where the drawer starts. Not shifted to
        // fit: that would slide it left over the sidebar instead.
        className="w-(--radix-popover-trigger-width) max-w-(--radix-popover-content-available-width) min-w-64 p-1"
        collisionPadding={besideEvent ? { right: EVENT_SHEET_WIDTH } : undefined}
        avoidCollisions={!besideEvent}
        onOpenAutoFocus={(event) => event.preventDefault()}
        // A click back into the field is not a click away from it.
        onInteractOutside={(event) => {
          if (event.target instanceof Element && event.target.closest("[data-event-search]")) {
            event.preventDefault();
          }
        }}
      >
        {options.length === 0 ? (
          <Hint />
        ) : (
          <>
            {options.length > 1 && (
              <p className="text-muted-foreground px-2 py-1.5 text-xs">
                This ID can be either. Choose one:
              </p>
            )}
            <ul className="flex flex-col">
              {options.map((option, index) => (
                <li key={option.kind === "mine" ? "mine" : optionKey(option.meaning)}>
                  <button
                    ref={index === 0 ? firstOption : undefined}
                    type="button"
                    // The parts sit in a row with no space between them: the
                    // name reads them as the sentence they are.
                    aria-label={
                      option.kind === "mine" ? "My activity" : meaningName(option.meaning)
                    }
                    className="hover:bg-accent focus-visible:bg-accent flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none"
                    onClick={() => choose(option)}
                  >
                    {option.kind === "mine" ? <Mine /> : <Meaning meaning={option.meaning} />}
                  </button>
                </li>
              ))}
            </ul>
            {term.trim() === "" && <Hint />}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** One filter in the field: its name, muted, its value in the code face, and its remove button. */
function Chip({
  name,
  value,
  onRemove,
  removeLabel,
}: {
  name: string;
  value: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <span className="bg-muted text-foreground flex h-6 max-w-64 min-w-0 items-center gap-1 rounded-sm pl-1.5 text-xs">
      <span className="text-muted-foreground shrink-0">{name}:</span>
      <IdText id={value} title={value} className="min-w-0" />
      <button
        type="button"
        aria-label={removeLabel}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex size-6 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-[3px]"
        onClick={onRemove}
      >
        <X aria-hidden className="size-3" />
      </button>
    </span>
  );
}

/** The search's own terms, under an empty field or one that means nothing. */
function Hint() {
  return (
    <p className="text-muted-foreground px-2 py-1.5 text-xs">
      Paste an ID, an event type or an operation, such as <Code>req_…</Code>,{" "}
      <Code>user.created</Code> or <Code>createUser</Code>, or name the filter: <Code>actor:</Code>,{" "}
      <Code>user:</Code>, <Code>resource:</Code>, <Code>resource_type:</Code>, <Code>app:</Code>,{" "}
      <Code>device:</Code>. There is no text search.
    </p>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="text-foreground">{children}</code>;
}

/** A meaning's key in the list: a term means each filter once at most. */
function optionKey(meaning: SearchMeaning): string {
  return meaning.kind === "event" ? "event" : meaning.filter.key;
}

/** An option's name: "Actor user_1, what it did". */
function meaningName(meaning: SearchMeaning): string {
  if (meaning.kind === "event") return `Open event ${meaning.id}`;
  const reading = READING[meaning.filter.key];
  return `${meaning.filter.label} ${meaning.value}${reading ? `, ${reading}` : ""}`;
}

/** My activity as an option: what it is, and what it sets. */
function Mine() {
  return (
    <>
      <UserRound aria-hidden strokeWidth={1.5} className="text-muted-foreground size-4 shrink-0" />
      <span className="text-foreground">My activity</span>
      <span className="text-muted-foreground ml-auto shrink-0 text-xs">actor: me</span>
    </>
  );
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
