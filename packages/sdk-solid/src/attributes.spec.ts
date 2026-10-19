import { describe, expect, it } from "vitest";

import { asElementAttributes } from "./attributes";

describe("asElementAttributes", () => {
  it("writes standard attributes under Solid's attribute prefix", () => {
    const attributes = asElementAttributes({ id: "a", "data-testid": "b", "aria-label": "c" });
    expect({ ...attributes }).toEqual({
      "attr:id": "a",
      "attr:data-testid": "b",
      "attr:aria-label": "c",
    });
  });

  it("leaves the props Solid applies to an element itself under their own names", () => {
    const onClick = () => undefined;
    const attributes = asElementAttributes({
      class: "a",
      classList: { b: true },
      style: "color: red",
      onClick,
    });
    expect({ ...attributes }).toEqual({
      class: "a",
      classList: { b: true },
      style: "color: red",
      onClick,
    });
  });

  it("writes true as a present attribute and false as an absent one", () => {
    const attributes = asElementAttributes({ hidden: true, "aria-hidden": false });
    expect(attributes["attr:hidden"]).toBe("");
    expect(attributes["attr:aria-hidden"]).toBeUndefined();
  });

  it("leaves out a prop that is not a standard attribute", () => {
    const attributes = asElementAttributes({ id: "a", "project-id": "b", purpose: "c", url: "d" });
    expect({ ...attributes }).toEqual({ "attr:id": "a" });
  });

  it("reads through to the props, so a changed value is seen", () => {
    const props = { title: "before" };
    const attributes = asElementAttributes(props);
    props.title = "after";
    expect(attributes["attr:title"]).toBe("after");
  });
});
