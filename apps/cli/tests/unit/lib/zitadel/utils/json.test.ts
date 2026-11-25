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
import { thrownBy } from "@tests/helpers/thrown-value";

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

describe("isJsonValue", () => {
  it.each([
    { value: { a: [1, "b", true, null, { c: {} }] }, expected: true },
    { value: "text", expected: true },
    { value: 0, expected: true },
    { value: false, expected: true },
    { value: null, expected: true },
    { value: { absent: undefined }, expected: true },
    { value: { list: [{ absent: undefined }] }, expected: true },
    { value: Object.assign(Object.create(null), { a: 1 }), expected: true },
    { value: { a: 1, [Symbol("key")]: () => undefined }, expected: true },
    { value: [undefined], expected: false },
    { value: Number.NaN, expected: false },
    { value: Number.NEGATIVE_INFINITY, expected: false },
    { value: { nested: [Number.POSITIVE_INFINITY] }, expected: false },
    { value: 1n, expected: false },
    { value: Symbol("value"), expected: false },
    { value: { when: () => undefined }, expected: false },
    { value: [{ deep: { when: () => undefined } }], expected: false },
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
      const error = thrownBy(() => {
        return toJsonObject(value, "The flow");
      });

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({ message: "The flow is not a JSON object" });
    },
  );
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

describe("withoutKey", () => {
  it("leaves out one key and keeps the rest in order", () => {
    expect(Object.keys(withoutKey({ a: 1, $schema: "x", b: 2 }, "$schema"))).toEqual(["a", "b"]);
  });
});
