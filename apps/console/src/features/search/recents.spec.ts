import { describe, expect, it } from "vitest";

import { clearSessionCaches } from "@/lib/session-cache";

import type { SearchHit } from "./model";
import { RECENT_HIT_LIMIT, recentHits, rememberHit } from "./recents";

const hit = (id: string, type: SearchHit["type"] = "user"): SearchHit => ({
  type,
  id,
  projectId: "proj_1",
  title: id,
});

describe("recent hits", () => {
  it("lists a project's hits most recent first, each once", () => {
    rememberHit("proj_1", hit("user_1"));
    rememberHit("proj_1", hit("team_1", "team"));
    rememberHit("proj_1", hit("user_1"));
    rememberHit("proj_2", hit("user_9"));

    expect(recentHits("proj_1").map((recent) => recent.id)).toEqual(["user_1", "team_1"]);
    expect(recentHits("proj_2").map((recent) => recent.id)).toEqual(["user_9"]);
  });

  it("keeps only the newest few", () => {
    for (let i = 0; i <= RECENT_HIT_LIMIT; i++) rememberHit("proj_3", hit(`user_${i}`));

    const ids = recentHits("proj_3").map((recent) => recent.id);
    expect(ids).toHaveLength(RECENT_HIT_LIMIT);
    expect(ids[0]).toBe(`user_${RECENT_HIT_LIMIT}`);
    expect(ids).not.toContain("user_0");
  });

  it("is dropped with the session", () => {
    rememberHit("proj_4", hit("user_1"));
    clearSessionCaches();
    expect(recentHits("proj_4")).toEqual([]);
  });
});
