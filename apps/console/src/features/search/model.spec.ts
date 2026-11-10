import { describe, expect, it } from "vitest";

import { type SearchAnswer, hasMore, hitsFor } from "./model";

const answer: SearchAnswer = {
  term: "ann",
  hits: [
    { type: "user", id: "user_1", title: "Ann Lee", subtitle: "ann@example.com" },
    { type: "user", id: "user_2", title: "Jo Bloggs", subtitle: "joann@example.com" },
    // Matched by the server on something the row does not show.
    { type: "user", id: "user_3", title: "Zed" },
    { type: "team", id: "team_1", title: "Annex" },
  ],
  incomplete: ["user"],
};

describe("hitsFor", () => {
  it("shows the answer for the text in the field whole, one type at a time", () => {
    expect(hitsFor(answer, " ann ", "user").map((hit) => hit.id)).toEqual([
      "user_1",
      "user_2",
      "user_3",
    ]);
    expect(hitsFor(answer, "ann", "team").map((hit) => hit.id)).toEqual(["team_1"]);
    expect(hitsFor(answer, "ann", "schema")).toEqual([]);
  });

  it("keeps an older answer's hits that the typing has not ruled out", () => {
    // A hit stays while its title or its subtitle still has the text, case aside.
    expect(hitsFor(answer, "ann l", "user").map((hit) => hit.id)).toEqual(["user_1"]);
    expect(hitsFor(answer, "ANN@", "user").map((hit) => hit.id)).toEqual(["user_1", "user_2"]);
    expect(hitsFor(answer, "annex", "team").map((hit) => hit.id)).toEqual(["team_1"]);
    expect(hitsFor(answer, "annexe", "team")).toEqual([]);
  });

  it("keeps the hit whose id is in the field", () => {
    const byId: SearchAnswer = { ...answer, term: "user_" };
    expect(hitsFor(byId, "user_3", "user").map((hit) => hit.id)).toEqual(["user_3"]);
  });

  it("shows nothing for an empty field", () => {
    expect(hitsFor(answer, "  ", "user")).toEqual([]);
  });
});

describe("hasMore", () => {
  it("is the server's word, for the text it answered only", () => {
    expect(hasMore(answer, "ann", "user")).toBe(true);
    expect(hasMore(answer, "ann", "team")).toBe(false);
    expect(hasMore(answer, "anne", "user")).toBe(false);
  });
});
