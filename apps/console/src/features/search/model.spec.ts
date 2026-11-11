import { describe, expect, it } from "vitest";

import { type SearchAnswer, closeness, hasMore, hitsFor, ranked } from "./model";

const answer: SearchAnswer = {
  term: "ann",
  hits: [
    {
      type: "user",
      id: "user_1",
      projectId: "proj_1",
      title: "Ann Lee",
      subtitle: "ann@example.com",
    },
    {
      type: "user",
      id: "user_2",
      projectId: "proj_1",
      title: "Jo Bloggs",
      subtitle: "joann@example.com",
    },
    // Matched by the server on something the row does not show.
    { type: "user", id: "user_3", projectId: "proj_1", title: "Zed" },
    { type: "team", id: "team_1", projectId: "proj_1", title: "Annex" },
  ],
  incomplete: ["user"],
  moreProjects: false,
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

describe("closeness", () => {
  it("puts the whole label, then its start, then a word's start, then inside it", () => {
    expect(closeness("logs", "Logs")).toBe(0);
    expect(closeness(" LOG ", "Logs")).toBe(1);
    expect(closeness("brand", "test-branding")).toBe(2);
    expect(closeness("hop", "Grace Hopper")).toBe(2);
    expect(closeness("shop", "my_shop")).toBe(2);
    expect(closeness("ann", "Joanne")).toBe(3);
  });

  it("puts a row the server matched on something else last", () => {
    expect(closeness("example", "Grace Hopper")).toBe(4);
  });
});

describe("ranked", () => {
  const row = (label: string, inProject: boolean, kind: number) => ({ label, inProject, kind });

  it("orders every kind by closeness first", () => {
    const rows = [
      row("Jo Logan", true, 2),
      row("Logbook", false, 5),
      row("Blogs", true, 3),
      row("Logs", true, 0),
    ];
    expect(ranked("log", rows).map((r) => r.label)).toEqual([
      "Logs",
      "Logbook",
      "Jo Logan",
      "Blogs",
    ]);
  });

  it("puts the selected project's rows first among equally close ones, then by kind", () => {
    const rows = [
      row("Settings", false, 6),
      row("Settings", true, 0),
      row("Setup", true, 3),
      row("Setup", true, 1),
    ];
    expect(ranked("set", rows)).toEqual([
      row("Settings", true, 0),
      row("Setup", true, 1),
      row("Setup", true, 3),
      row("Settings", false, 6),
    ]);
  });

  it("keeps the order rows came in when nothing else tells them apart", () => {
    // The server ranks within a kind; a match on what is not shown keeps it.
    const rows = [row("Zed", true, 2), row("Amy", true, 2)];
    expect(ranked("user_", rows).map((r) => r.label)).toEqual(["Zed", "Amy"]);
  });
});
