import { describe, expect, it } from "vitest";

import { standardAttributes } from "./attributes";

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
      tabindex: 3,
      "data-testid": "e",
      "aria-label": "f",
    };
    expect(standardAttributes(attributes)).toEqual(attributes);
  });

  it("leaves out a prop that is not a standard attribute", () => {
    expect(
      standardAttributes({ id: "a", project: {}, "project-id": "b", purpose: "c", onFlowStep$: 1 }),
    ).toEqual({ id: "a" });
  });
});
