import type { ReactNode } from "react";

import { formatDate } from "@/lib/date";

/**
 * What a list's filter (`src/components/resource-filter.tsx`) is told about the
 * resource: one definition per property the list can be narrowed by. The
 * definition's `type` decides how a value is chosen; the values themselves are
 * strings, as the URL carries them.
 */

/** The chosen values by filter key; a key that is absent or `undefined` is not set. */
export type FilterValues = Readonly<Record<string, string | undefined>>;

interface FilterBase {
  /** The value's key in `FilterValues`, which is the screen's search param. */
  key: string;
  /** The property's name as the menu and the chip show it: `User schema`. */
  label: string;
  /** The property in the controls' accessible names (`Filter by schema`); the label in lower case by default. */
  name?: string;
  /**
   * Why the property cannot be chosen right now, in a few words: it is listed,
   * disabled, with this beside it. A value it already has stays clearable.
   */
  unavailable?: string;
  /** The filters a new value of this one clears with it: a revision goes with its schema. */
  clears?: string[];
}

/** One value an `options` filter offers. */
export interface FilterOption {
  value: string;
  /** The value's name, and what typing finds it by. */
  label: string;
  /** The row in place of the label alone. */
  content?: ReactNode;
  /** The row's `title`, for a value its row cuts short. */
  title?: string;
  /** Draws a hairline under the row, to set a special value apart from the rest. */
  separated?: boolean;
}

/** A property with a known set of values, one of which is chosen from a searchable list. */
export interface OptionsFilter extends FilterBase {
  type: "options";
  options: FilterOption[];
  /** A chosen value on its chip; by default its option's label, else the value itself. */
  display?: (value: string) => ReactNode;
  /** For the list of values, where a row needs more than the default width. */
  menuClassName?: string;
}

/** A moment the resource carries, narrowed to a range that ends now: a preset, or since a day. */
export interface DateFilter extends FilterBase {
  type: "date";
}

export type FilterDefinition = OptionsFilter | DateFilter;

/** Whether any of the filters is set: what a screen's "no match" state and its Clear button ask. */
export function isFiltered(filters: FilterDefinition[], values: FilterValues): boolean {
  return filters.some((filter) => !!values[filter.key]);
}

/** Every filter unset, as a patch for the screen's search. */
export function clearedFilters(filters: FilterDefinition[]): Record<string, undefined> {
  return Object.fromEntries(filters.map((filter) => [filter.key, undefined]));
}

/** The ranges a date filter offers, counted back from when the list is read. */
export const DATE_RANGES = ["24h", "7d", "30d", "90d"] as const;
export type DateRange = (typeof DATE_RANGES)[number];

export const DATE_RANGE_LABEL: Record<DateRange, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

const HOUR_MS = 60 * 60 * 1000;
const DATE_RANGE_MS: Record<DateRange, number> = {
  "24h": 24 * HOUR_MS,
  "7d": 7 * 24 * HOUR_MS,
  "30d": 30 * 24 * HOUR_MS,
  "90d": 90 * 24 * HOUR_MS,
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function isDateRange(value: string): value is DateRange {
  return (DATE_RANGES as readonly string[]).includes(value);
}

/** A `YYYY-MM-DD` day as the start of that day in the viewer's time zone; nothing for a day there is not. */
function startOfDay(value: string): Date | undefined {
  const match = DAY.exec(value);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  // `2026-02-31` would roll over into March.
  return date.getMonth() === month - 1 && date.getDate() === day ? date : undefined;
}

/**
 * A date filter's value as a URL may carry it: one of `DATE_RANGES`, or a
 * `YYYY-MM-DD` day. Anything else is no filter.
 */
export function parseDateFilter(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return isDateRange(value) || startOfDay(value) ? value : undefined;
}

/**
 * The moment a date filter's range starts at: a preset counted back from
 * `now`, a day from its first moment in the viewer's time zone.
 */
export function dateFilterStart(value: string, now: Date = new Date()): Date | undefined {
  if (isDateRange(value)) return new Date(now.getTime() - DATE_RANGE_MS[value]);
  return startOfDay(value);
}

/** A date filter's value in words: `Last 7 days`, or `Since 1 Nov 2026` in the viewer's locale. */
export function dateFilterLabel(value: string): string {
  if (isDateRange(value)) return DATE_RANGE_LABEL[value];
  const start = startOfDay(value);
  return start ? `Since ${formatDate(start.toISOString())}` : value;
}

/** Today as a date field holds it, in the viewer's time zone. */
export function today(now: Date = new Date()): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
