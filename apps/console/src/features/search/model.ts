/** A kind of thing `POST /search` finds in a project (root ADR 087). */
export type SearchResultType = "user" | "team" | "schema" | "flow_definition" | "idp";

/** One match: a reference to a resource, not the resource. */
export interface SearchHit {
  type: SearchResultType;
  id: string;
  /** The project it is in, which opening it selects. */
  projectId: string;
  /** What to call it. */
  title: string;
  /** A second line that tells two titles apart, when the server has one. */
  subtitle?: string;
}

/** What one search answered, and the text it answers. */
export interface SearchAnswer {
  term: string;
  hits: SearchHit[];
  /** The types that have more matches than `hits` holds. */
  incomplete: SearchResultType[];
  /**
   * Searched without a project, the person can act on more projects than one
   * search reads, so the hits come from the first of them.
   */
  moreProjects: boolean;
}

/** No answer yet, and a failed search's: nothing found. */
export const NO_ANSWER: SearchAnswer = { term: "", hits: [], incomplete: [], moreProjects: false };

/**
 * Users are asked for apart from the rest. They are searched only from
 * `USER_SEARCH_MIN_LENGTH` characters on, and the server answers the types of
 * one request in turn, so apart neither answer waits for the other's reads.
 */
export const USER_TYPES = ["user"] as const satisfies readonly SearchResultType[];
export const OTHER_TYPES = [
  "team",
  "schema",
  "flow_definition",
  "idp",
] as const satisfies readonly SearchResultType[];

/** The server matches users from this many characters; a shorter search is not sent. */
export const USER_SEARCH_MIN_LENGTH = 3;

/**
 * The hits of `type` to show for what is in the field now. An answer for that
 * exact text is shown whole: the server decides what matches. An older answer
 * stays up until the next lands, so the list does not empty between
 * keystrokes, minus the hits the typing has since ruled out.
 */
export function hitsFor(answer: SearchAnswer, query: string, type: SearchResultType): SearchHit[] {
  const text = query.trim();
  if (!text) return [];
  const hits = answer.hits.filter((hit) => hit.type === type);
  if (answer.term === text) return hits;
  const folded = text.toLowerCase();
  return hits.filter(
    (hit) =>
      hit.id === text ||
      hit.title.toLowerCase().includes(folded) ||
      (hit.subtitle?.toLowerCase().includes(folded) ?? false),
  );
}

/** Whether `answer` is for the text in the field and says `type` has more than it lists. */
export function hasMore(answer: SearchAnswer, query: string, type: SearchResultType): boolean {
  return answer.term === query.trim() && answer.incomplete.includes(type);
}

/**
 * How closely `label` matches the typed text, lower being closer: the whole
 * label, its start, the start of one of its words, somewhere inside it, or
 * not at all. The last is a row the server matched on what the row does not
 * name it by: an id, or a user's identifier under their name.
 */
export function closeness(query: string, label: string): number {
  const text = query.trim().toLowerCase();
  const folded = label.toLowerCase();
  if (folded === text) return 0;
  if (folded.startsWith(text)) return 1;
  if (folded.split(WORD_BREAK).some((word) => word.startsWith(text))) return 2;
  if (folded.includes(text)) return 3;
  return 4;
}

/** What starts a word inside a label: `test-branding`, `Grace Hopper`, `my_shop`. */
const WORD_BREAK = /[\s\-_./@]+/;

/** What `ranked` needs to know of a row. */
export interface Rankable {
  /** The name the row shows, which the typing is matched against. */
  label: string;
  /** Whether it is in the selected project rather than above every project. */
  inProject: boolean;
  /** Its kind, as the caller orders kinds: lower first. */
  kind: number;
}

/**
 * Rows of every kind as one list, closest match first (`closeness`). Among
 * rows as close as each other, the selected project's come before what is
 * above every project, then by kind, then in the order they came, which keeps
 * the server's own ranking within a kind.
 */
export function ranked<T extends Rankable>(query: string, rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index, close: closeness(query, row.label) }))
    .sort(
      (a, b) =>
        a.close - b.close ||
        Number(b.row.inProject) - Number(a.row.inProject) ||
        a.row.kind - b.row.kind ||
        a.index - b.index,
    )
    .map(({ row }) => row);
}
