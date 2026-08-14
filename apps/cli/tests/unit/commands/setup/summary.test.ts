import { describe, expect, it } from "vitest";

import { designWarnings, relativeDisplayPath } from "../../../../src/commands/setup/summary";

describe("relativeDisplayPath", () => {
  it("normalizes Windows paths for repository-style suffix matching", () => {
    const displayed = relativeDisplayPath(
      "C:\\repo",
      "C:\\repo\\.zitadel\\schemas\\default-human-user.json",
    );

    expect(displayed).toBe(".zitadel/schemas/default-human-user.json");
    expect(displayed.endsWith(".zitadel/schemas/default-human-user.json")).toBe(true);
  });

  it("does not strip a sibling path that merely shares the cwd prefix", () => {
    expect(relativeDisplayPath("C:\\repo", "C:\\repository\\file.json")).toBe(
      "C:/repository/file.json",
    );
  });
});

describe("designWarnings", () => {
  it("describes the container-width contract without claiming the pane is already collapsed", () => {
    const [warning, ...rest] = designWarnings({ design: "split-right", posture: "widget" });

    expect(rest).toEqual([]);
    expect(warning).toBeDefined();
    // The pane is keyed to the login's container width, and the wrapper the
    // CLI scaffolds does not constrain it — the pane renders there. Claiming
    // "this app shows the compact mark instead" sends users hunting for a
    // rendering bug that isn't happening.
    expect(warning).not.toMatch(/this app/i);
    expect(warning).toContain("container is wide");
    expect(warning).toContain("collapses it to the compact brand mark");
    // The actionable half has to survive any rewording.
    expect(warning).toContain("logo_url");
    expect(warning).toContain("hero_url");
    expect(warning).toContain(".zitadel/branding/branding.json");
  });

  it("names the chosen design", () => {
    expect(designWarnings({ design: "split", posture: "widget" })[0]).toContain("The split design");
  });

  it("stays quiet for designs that survive a narrow container", () => {
    // `hero`'s compact fallback is editable text, and the non-split designs
    // have no brand pane to collapse.
    expect(designWarnings({ design: "hero", posture: "widget" })).toEqual([]);
    expect(designWarnings({ design: "centered", posture: "widget" })).toEqual([]);
    expect(designWarnings({ design: "minimal", posture: "widget" })).toEqual([]);
    expect(designWarnings({ posture: "widget" })).toEqual([]);
  });

  it("stays quiet in page posture, where the login owns the container", () => {
    expect(designWarnings({ design: "split", posture: "page" })).toEqual([]);
    expect(designWarnings({ design: "split-right", posture: "page" })).toEqual([]);
  });
});
