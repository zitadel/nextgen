import { dedupeUnionType } from "orval";
import { describe, expect, it } from "vitest";

// orval dedupes every union it emits by splitting it on its top-level `|`.
// Unpatched, that scan reads a quote or bracket in a member's JSDoc ("the
// server's clock") as code, splits members in the middle, and drops the pieces
// that repeat: the event union lost its shared fields this way.
// patches/@orval__core@8.42.0.patch makes it skip comments.
describe("dedupeUnionType", () => {
  const member = (eventType: string) => `({
  /** The event's ID. */
  id: string;
  team_id?: string | null;
  /** When it happened. */
  occurred_at: string;
  actor_id?: string | null;
}) & {
  event_type: '${eventType}';
}`;

  it("keeps members whole when their JSDoc has an apostrophe", () => {
    const union = [member("a.created"), member("b.created"), member("a.created")].join(" | ");

    expect(dedupeUnionType(union)).toBe([member("a.created"), member("b.created")].join(" | "));
  });

  it("never splits on a | inside a comment", () => {
    expect(dedupeUnionType("/** a | b */ A | /** a | b */ B | /** a | b */ B")).toBe(
      "/** a | b */ A | /** a | b */ B",
    );
  });

  it("ignores a bracket or a double quote inside a comment", () => {
    const member = '{ /** a < b, "1) first */ x: string | null }';

    expect(dedupeUnionType(`${member} | ${member}`)).toBe(member);
  });

  it("still dedupes string literal members", () => {
    expect(dedupeUnionType("'a' | 'b' | 'a'")).toBe("'a' | 'b'");
  });
});
