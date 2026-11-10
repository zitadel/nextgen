/** A kind of thing `POST /search` finds in a project (root ADR 087). */
export type SearchResultType = "user" | "team" | "schema" | "flow_definition" | "idp";

/** One match: a reference to a resource, not the resource. */
export interface SearchHit {
  type: SearchResultType;
  id: string;
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
}

/** No answer yet, and a failed search's: nothing found. */
export const NO_ANSWER: SearchAnswer = { term: "", hits: [], incomplete: [] };

/**
 * Users are asked for apart from the rest. Their match reads every identifier
 * of the project and the server answers the types of one request in turn, so
 * in one request the quick types would wait for the slow one.
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
