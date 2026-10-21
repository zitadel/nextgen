import { describe, expect, expectTypeOf, it } from "vitest";

import { standardAttributes } from "./types.js";

describe("standardAttributes", () => {
  it("keeps the standard attributes", () => {
    const attributes = {
      class: "a",
      className: "g",
      style: "color: red",
      id: "b",
      title: "c",
      slot: "d",
      hidden: true,
      role: "region",
      tabindex: 3,
      tabIndex: 4,
      "data-testid": "e",
      "aria-label": "f",
    };
    expect(standardAttributes(attributes)).toEqual(attributes);
  });

  it("keeps the values 0 and the empty string", () => {
    expect(standardAttributes({ tabindex: 0, title: "" })).toEqual({ tabindex: 0, title: "" });
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
  ])("leaves out a value of %s", (_name, value) => {
    expect(standardAttributes({ id: value, "aria-label": value, "data-x": value })).toEqual({});
  });

  it("leaves out false for a boolean attribute", () => {
    expect(standardAttributes({ hidden: false, id: "a" })).toEqual({ id: "a" });
  });

  it("keeps false for aria-* and data-*, which render as the string false", () => {
    expect(standardAttributes({ "aria-hidden": false, "data-open": false })).toEqual({
      "aria-hidden": "false",
      "data-open": "false",
    });
  });

  it("writes true for aria-* and data-* as the string true, and keeps it for hidden", () => {
    expect(standardAttributes({ "aria-expanded": true, "data-open": true, hidden: true })).toEqual({
      "aria-expanded": "true",
      "data-open": "true",
      hidden: true,
    });
  });

  it.each([
    "onclick",
    "onClick",
    "srcdoc",
    "is",
    "key",
    "ref",
    "children",
    "dangerouslySetInnerHTML",
    "part",
    "lang",
    "dir",
    "classList",
    "project",
    "project-id",
    "purpose",
    "Class",
    "ID",
    "DATA-x",
    "ARIA-label",
    "Tabindex",
    "data-",
    "aria-",
    "database",
    "arial",
  ])("leaves out %s", (name) => {
    expect(standardAttributes({ [name]: "x" })).toEqual({});
  });

  it("puts the prefix before each name except class, className and style", () => {
    expect(
      standardAttributes(
        { id: "a", class: "b", className: "c", style: "d", "aria-label": "e", project: {} },
        "attr:",
      ),
    ).toEqual({ "attr:id": "a", class: "b", className: "c", style: "d", "attr:aria-label": "e" });
  });

  it("types the result as the standard attributes only, keeping each value type", () => {
    const attributes = standardAttributes({ id: "a", hidden: true, project: 1 });
    expectTypeOf(attributes).toEqualTypeOf<{ id?: string; hidden?: boolean }>();
    const prefixed = standardAttributes({ id: "a", style: "b" }, "attr:");
    expectTypeOf(prefixed).toEqualTypeOf<{ "attr:id"?: string; style?: string }>();
  });
});
