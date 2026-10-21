import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  jsonValue,
  mergeDocuments,
  setAt,
  typedValue,
  valueAt,
} from "../../../../../src/lib/oclif/crud";
import type { ZodLike } from "../../../../../src/lib/oclif/crud/zod";

const as = (schema: unknown): ZodLike => schema as ZodLike;

describe("mergeDocuments", () => {
  it("merges objects key by key, at every depth", () => {
    expect(
      mergeDocuments(
        { schema: "s", attributes: { email: "a@b.c", givenName: "Ada" } },
        { attributes: { givenName: "Augusta" } },
      ),
    ).toEqual({ schema: "s", attributes: { email: "a@b.c", givenName: "Augusta" } });
  });

  it("replaces a list rather than merging into it", () => {
    expect(mergeDocuments({ scopes: ["openid", "profile"] }, { scopes: ["openid"] })).toEqual({
      scopes: ["openid"],
    });
  });

  it("keeps a null, which an update sends so the server removes the key", () => {
    expect(
      mergeDocuments({ attributes: { phone: "+1" } }, { attributes: { phone: null } }),
    ).toEqual({ attributes: { phone: null } });
  });

  it("lets a null replace a whole object, keeping the keys beside it", () => {
    expect(
      mergeDocuments(
        { slug: "acme", oidc: { issuer: "https://sso.acme.example", client_id: "acme" } },
        { oidc: null },
      ),
    ).toEqual({ slug: "acme", oidc: null });
  });

  it("lets an object replace a scalar, and the other way round", () => {
    expect(mergeDocuments({ a: "x" }, { a: { b: 1 } })).toEqual({ a: { b: 1 } });
    expect(mergeDocuments({ a: { b: 1 } }, { a: "x" })).toEqual({ a: "x" });
  });

  it("takes a key named __proto__ as data, not as the object's prototype", () => {
    const merged = mergeDocuments({}, JSON.parse('{"__proto__":{"polluted":true}}')) as Record<
      string,
      unknown
    >;
    expect(Object.hasOwn(merged, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("setAt and valueAt", () => {
  it("creates the objects on the way to a path", () => {
    expect(setAt({}, ["oidc", "issuer"], "https://x")).toEqual({ oidc: { issuer: "https://x" } });
  });

  it("replaces a value in the way", () => {
    expect(setAt({ oidc: null }, ["oidc", "issuer"], "https://x")).toEqual({
      oidc: { issuer: "https://x" },
    });
  });

  it("reads a path, and nothing past a missing segment", () => {
    const document = { oidc: { issuer: "https://x" } };
    expect(valueAt(document, ["oidc", "issuer"])).toBe("https://x");
    expect(valueAt(document, ["oidc", "scopes", "0"])).toBeUndefined();
    expect(valueAt(document, ["toString"])).toBeUndefined();
  });
});

describe("typedValue", () => {
  it("keeps text where the schema takes a string or says nothing", () => {
    expect(typedValue(as(z.string()), "02139", "--set postcode")).toBe("02139");
    expect(typedValue(undefined, "02139", "--set postcode")).toBe("02139");
    expect(typedValue(as(z.union([z.boolean(), z.string()])), "true", "--set v")).toBe("true");
  });

  it("reads a number or a boolean where the schema declares one", () => {
    expect(typedValue(as(z.number()), "1.5", "--set ratio")).toBe(1.5);
    expect(typedValue(as(z.int()), "3", "--set time")).toBe(3);
    expect(typedValue(as(z.boolean().default(true)), "false", "--set pkce")).toBe(false);
    expect(typedValue(as(z.union([z.null(), z.int()])), "4", "--set n")).toBe(4);
  });

  it.each(["3", "-12", "007"])("reads the integer %j in decimal notation", (text) => {
    expect(typedValue(as(z.int()), text, "--set n")).toBe(Number(text));
  });

  it.each(["0x10", "1e3", " 12 ", "+5", "3.0", "", "Infinity", "9".repeat(400)])(
    "refuses %j for an integer rather than reading it another way",
    (text) => {
      expect(() => typedValue(as(z.int()), text, "--set n")).toThrowError(
        expect.objectContaining({ message: `--set n expects an integer, got "${text}"` }),
      );
    },
  );

  it.each([
    ["1.5", 1.5],
    ["-0.25", -0.25],
    ["2", 2],
  ])("reads the number %j in decimal notation", (text, value) => {
    expect(typedValue(as(z.number()), text, "--set ratio")).toBe(value);
  });

  it.each(["0x10", "1e3", ".5", "5.", "1_000", "NaN"])("refuses %j for a number", (text) => {
    expect(() => typedValue(as(z.number()), text, "--set ratio")).toThrowError(
      expect.objectContaining({ message: `--set ratio expects a number, got "${text}"` }),
    );
  });

  it("keeps `null` as text where the field takes a string or null; `:=null` is the null", () => {
    expect(typedValue(as(z.string().nullable()), "null", "--set x")).toBe("null");
    expect(typedValue(as(z.union([z.string(), z.null()])), "null", "--set x")).toBe("null");
    expect(jsonValue("null", "--set x")).toBeNull();
  });

  it("refuses text that does not fit, offering the JSON form", () => {
    expect(() => typedValue(as(z.int()), "3.5", "--set time")).toThrowError(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: '--set time expects an integer, got "3.5"',
        hint: expect.stringContaining("--set time:=<json>"),
      }),
    );
    expect(() => typedValue(as(z.boolean()), "yes", "--set pkce")).toThrowError(
      expect.objectContaining({ message: '--set pkce expects true or false, got "yes"' }),
    );
  });
});

describe("jsonValue", () => {
  it("reads JSON", () => {
    expect(jsonValue('["openid"]', "--set scopes")).toEqual(["openid"]);
  });

  it("refuses text that is not JSON, offering the string form", () => {
    expect(() => jsonValue("thirty", "--attributes age")).toThrowError(
      expect.objectContaining({
        message: '--attributes age:= expects JSON, got "thirty"',
        hint: expect.stringContaining("--attributes age=thirty"),
      }),
    );
  });
});
