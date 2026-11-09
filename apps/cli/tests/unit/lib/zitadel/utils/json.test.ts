import { describe, expect, it } from "vitest";

import { isJsonObject, listAt, objectAt, stringsIn } from "@/lib/zitadel/utils/json";

describe("isJsonObject", () => {
  it.each([
    { value: {}, expected: true },
    { value: [], expected: false },
    { value: null, expected: false },
    { value: "text", expected: false },
  ])("says $expected for $value", ({ value, expected }) => {
    expect(isJsonObject(value)).toBe(expected);
  });
});

describe("stringsIn", () => {
  it("keeps the strings of a list in order", () => {
    expect(stringsIn(["a", 1, "b", null])).toEqual(["a", "b"]);
  });

  it("reads anything but a list as none", () => {
    expect(stringsIn("a")).toEqual([]);
  });
});

describe("objectAt", () => {
  it("returns the object at the key", () => {
    expect(objectAt({ key: { a: 1 } }, "key")).toEqual({ a: 1 });
  });

  it("reads anything but an object as an empty one", () => {
    expect(objectAt({ key: ["a"] }, "key")).toEqual({});
  });
});

describe("listAt", () => {
  it("returns the very list at the key", () => {
    const list = ["a", 1];

    expect(listAt({ key: list }, "key")).toBe(list);
  });

  it("reads anything but a list as an empty one", () => {
    expect(listAt({ key: { a: 1 } }, "key")).toEqual([]);
  });
});
