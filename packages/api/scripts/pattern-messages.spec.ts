import { describe, expect, it } from "vitest";

import { collectPatternMessages, withPatternMessages } from "./pattern-messages";

const KEY = "x-zitadel-pattern-message";

describe("collectPatternMessages", () => {
  it("keys a message by its pattern, wherever the pattern is used", () => {
    const spec = {
      a: { pattern: "^a$", [KEY]: "must be a" },
      b: { nested: { pattern: "^a$", [KEY]: "must be a" } },
    };

    expect(collectPatternMessages(spec)).toEqual({
      messages: new Map([["^a$", "must be a"]]),
      missing: [],
      conflicting: [],
    });
  });

  it("names a pattern that has no message", () => {
    expect(collectPatternMessages({ a: { pattern: "^a$" } }).missing).toEqual(["^a$"]);
  });

  it("names a pattern that has two messages", () => {
    const spec = {
      a: { pattern: "^a$", [KEY]: "must be a" },
      b: { pattern: "^a$", [KEY]: "must be an a" },
    };

    expect(collectPatternMessages(spec).conflicting).toEqual(["^a$"]);
  });

  it("does not call a pattern missing when it has a message elsewhere", () => {
    const spec = { a: { pattern: "^a$", [KEY]: "must be a" }, b: { pattern: "^a$" } };

    expect(collectPatternMessages(spec).missing).toEqual([]);
  });

  it("skips sample data and a property that is only named pattern", () => {
    const spec = {
      example: { pattern: "https://*-acmeinc.vercel.app" },
      properties: { pattern: { type: "string" } },
    };

    expect(collectPatternMessages(spec)).toEqual({
      messages: new Map(),
      missing: [],
      conflicting: [],
    });
  });

  it("reads a spec that cycles", () => {
    const node: Record<string, unknown> = { pattern: "^a$", [KEY]: "must be a" };
    node.self = node;

    expect(collectPatternMessages(node).messages.get("^a$")).toBe("must be a");
  });
});

describe("withPatternMessages", () => {
  const source = [
    "export const userIdRegExp = new RegExp('^user_[a-z]+$');",
    "export const User = zod.object({ id: zod.string().regex(userIdRegExp) });",
    "export const Other = zod.object({ id: zod.string().regex(userIdRegExp).max(9) });",
  ].join("\n");

  it("gives every regex call the message of its pattern", () => {
    const messages = new Map([["^user_[a-z]+$", "must be a user ID"]]);

    expect(withPatternMessages(source, messages)).toBe(
      [
        "export const userIdRegExp = new RegExp('^user_[a-z]+$');",
        'export const User = zod.object({ id: zod.string().regex(userIdRegExp, "must be a user ID") });',
        'export const Other = zod.object({ id: zod.string().regex(userIdRegExp, "must be a user ID").max(9) });',
      ].join("\n"),
    );
  });

  it("reads the pattern as orval escapes it", () => {
    const escaped =
      "export const aRegExp = new RegExp('^\\\\d+\\\\.\\\\d+$|it\\'s');\nzod.string().regex(aRegExp)";
    const messages = new Map([["^\\d+\\.\\d+$|it's", "must be a version"]]);

    expect(withPatternMessages(escaped, messages)).toContain(
      '.regex(aRegExp, "must be a version")',
    );
  });

  it("leaves out the url check, which trims the value and says less than the message", () => {
    const generated = [
      "export const logoRegExp = new RegExp('^https://');",
      'export const Logo = zod.object({ "logo_url": zod.url().max(logoMax).regex(logoRegExp).optional() });',
    ].join("\n");

    expect(withPatternMessages(generated, new Map([["^https://", "must be https"]]))).toContain(
      '"logo_url": zod.string().max(logoMax).regex(logoRegExp, "must be https").optional()',
    );
  });

  it("leaves out min(1) when the pattern already refuses an empty string", () => {
    const generated = [
      "export const nameRegExp = new RegExp('^[a-z]+$');",
      "export const Name = zod.string().min(1).max(nameMax).regex(nameRegExp);",
    ].join("\n");

    expect(withPatternMessages(generated, new Map([["^[a-z]+$", "must be letters"]]))).toContain(
      'zod.string().max(nameMax).regex(nameRegExp, "must be letters")',
    );
  });

  it("keeps min(1) when the pattern accepts an empty string", () => {
    const generated = [
      "export const nameRegExp = new RegExp('^[a-z]*$');",
      "export const Name = zod.string().min(1).regex(nameRegExp);",
    ].join("\n");

    expect(withPatternMessages(generated, new Map([["^[a-z]*$", "must be letters"]]))).toContain(
      'zod.string().min(1).regex(nameRegExp, "must be letters")',
    );
  });

  it("refuses a generated pattern the spec gave no message", () => {
    expect(() => withPatternMessages(source, new Map())).toThrow(/\^user_\[a-z\]\+\$/);
  });

  it("leaves a regex call it holds no constant for as it is", () => {
    expect(withPatternMessages("zod.string().regex(elsewhere)", new Map())).toBe(
      "zod.string().regex(elsewhere)",
    );
  });
});
