import { describe, expect, it } from "vitest";

import { ConfigError } from "@/lib/zitadel";
import {
  isJsonObject,
  isJsonValue,
  listAt,
  objectAt,
  stringAt,
  stringsIn,
  toJsonObject,
  withoutKey,
} from "@/lib/zitadel/utils/json";

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

describe("isJsonValue", () => {
  it.each([
    { value: { a: [1, "b", true, null, { c: {} }] }, expected: true },
    { value: { absent: undefined }, expected: true },
    { value: [undefined], expected: false },
    { value: Number.NaN, expected: false },
    { value: { when: () => undefined }, expected: false },
    { value: undefined, expected: false },
  ])("says $expected for $value", ({ value, expected }) => {
    expect(isJsonValue(value)).toBe(expected);
  });
});

describe("toJsonObject", () => {
  it("hands back a JSON object as it is", () => {
    const body = { name: "default-login" };

    expect(toJsonObject(body, "The flow")).toBe(body);
  });

  it.each([[["list"]], ["text"], [{ nested: Number.POSITIVE_INFINITY }]])(
    "refuses %j, naming what it is",
    (value) => {
      expect(() => toJsonObject(value, "The flow")).toThrow(
        new ConfigError("The flow is not a JSON object"),
      );
    },
  );
});

describe("stringsIn", () => {
  it("keeps the strings of a list in order", () => {
    expect(stringsIn(["a", 1, "b", null])).toEqual(["a", "b"]);
  });

  it("reads anything but a list as none", () => {
    expect(stringsIn("a")).toEqual([]);
  });
});

describe("stringAt", () => {
  it("reads a string", () => {
    expect(stringAt({ key: "value" }, "key")).toBe("value");
  });

  it("reads anything but a string as nothing", () => {
    expect(stringAt({ key: 1 }, "key")).toBeUndefined();
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

describe("withoutKey", () => {
  it("leaves out one key and keeps the rest in order", () => {
    expect(Object.keys(withoutKey({ a: 1, $schema: "x", b: 2 }, "$schema"))).toEqual(["a", "b"]);
  });
});
