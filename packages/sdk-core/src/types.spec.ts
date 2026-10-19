// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { forwardStandardAttributes, standardAttributes } from "./types.js";

describe("standardAttributes", () => {
  it("keeps the standard attributes", () => {
    const attributes = {
      class: "a",
      style: "color: red",
      id: "b",
      title: "c",
      slot: "d",
      hidden: true,
      role: "region",
      tabIndex: 3,
      "data-testid": "e",
      "aria-label": "f",
    };
    expect(standardAttributes(attributes)).toEqual(attributes);
  });

  it("leaves out everything else", () => {
    expect(
      standardAttributes({ id: "a", project: {}, "project-id": "b", purpose: "c", lang: "d" }),
    ).toEqual({ id: "a" });
  });
});

describe("forwardStandardAttributes", () => {
  it("moves the standard attributes and leaves the rest", () => {
    const from = document.createElement("a-tag");
    const to = document.createElement("b-tag");
    from.setAttribute("class", "a b");
    from.setAttribute("data-testid", "probe");
    from.setAttribute("projectId", "proj-test");
    forwardStandardAttributes(from, to);
    expect(to.className).toBe("a b");
    expect(to.getAttribute("data-testid")).toBe("probe");
    expect(from.hasAttribute("class")).toBe(false);
    expect(from.hasAttribute("data-testid")).toBe(false);
    expect(from.getAttribute("projectId")).toBe("proj-test");
    expect(to.hasAttribute("projectid")).toBe(false);
  });

  it("copies the slot and keeps it where the parent's shadow root reads it", () => {
    const from = document.createElement("a-tag");
    const to = document.createElement("b-tag");
    from.setAttribute("slot", "probe");
    forwardStandardAttributes(from, to);
    expect(to.getAttribute("slot")).toBe("probe");
    expect(from.getAttribute("slot")).toBe("probe");
  });
});
