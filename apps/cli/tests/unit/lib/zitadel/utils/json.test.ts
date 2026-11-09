import { describe, expect, it } from "vitest";

import { isJsonObject, listAt, objectAt, stringsIn } from "@/lib/zitadel/utils/json";

describe("isJsonObject", () => {
  it.each([
    { value: {}, expected: true },
    { value: [], expected: false },
    { value: null, expected: false },
    { value: "text", expected: false },
  ])("says $expected for $value", ({ value, expected }) => {
    const isObject = isJsonObject(value);

    expect(isObject).toBe(expected);
  });
});

describe("stringsIn", () => {
  it("keeps the strings of a list in order", () => {
    const strings = stringsIn(["a", 1, "b", null]);

    expect(strings).toEqual(["a", "b"]);
  });

  it("reads anything but a list as none", () => {
    const strings = stringsIn("a");

    expect(strings).toEqual([]);
  });
});

describe("objectAt", () => {
  it("returns the object at the key", () => {
    const object = objectAt({ key: { a: 1 } }, "key");

    expect(object).toEqual({ a: 1 });
  });

  it("reads anything but an object as an empty one", () => {
    const object = objectAt({ key: ["a"] }, "key");

    expect(object).toEqual({});
  });
});

describe("listAt", () => {
  it("returns the very list at the key", () => {
    const list = ["a", 1];

    const found = listAt({ key: list }, "key");

    expect(found).toBe(list);
  });

  it("reads anything but a list as an empty one", () => {
    const list = listAt({ key: { a: 1 } }, "key");

    expect(list).toEqual([]);
  });
});
