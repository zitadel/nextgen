import { describe, expect, it } from "vitest";

import {
  atLeastOne,
  excludes,
  needs,
  placeholdersOf,
  refuses,
} from "../../../../src/lib/oclif/rules";

const REFUSAL = {
  message: "No",
};

function view(flags: Record<string, unknown>, args: Record<string, unknown> = {}) {
  return {
    flags,
    args,
    argv: [],
  };
}

describe("excludes", () => {
  const rule = excludes("follow", "json", REFUSAL);

  it("is broken when both are given", () => {
    expect(rule.broken(view({ follow: true, json: true }))).toBe(true);
  });

  it("holds when only one is given", () => {
    expect(rule.broken(view({ follow: true }))).toBe(false);
  });

  it("treats a false boolean as not given", () => {
    expect(rule.broken(view({ follow: true, json: false }))).toBe(false);
  });
});

describe("needs", () => {
  it("is broken when the flag is given without the one it needs", () => {
    expect(needs("sso-client-id", "sso", REFUSAL).broken(view({ "sso-client-id": "id" }))).toBe(
      true,
    );
  });

  it("holds when the flag is not given", () => {
    expect(needs("sso-client-id", "sso", REFUSAL).broken(view({}))).toBe(false);
  });

  it("holds when the flag it needs is given", () => {
    expect(
      needs("sso-client-id", "sso", REFUSAL).broken(view({ "sso-client-id": "id", sso: "x" })),
    ).toBe(false);
  });

  it("is broken when the flag it needs holds another value", () => {
    const rule = needs("image", { runtime: "docker" }, REFUSAL);

    expect(rule.broken(view({ image: "tag", runtime: "binary" }))).toBe(true);
  });

  it("holds when the flag it needs holds that value", () => {
    const rule = needs("image", { runtime: "docker" }, REFUSAL);

    expect(rule.broken(view({ image: "tag", runtime: "docker" }))).toBe(false);
  });

  it("reads an argument as it reads a flag", () => {
    expect(needs("image", "name", REFUSAL).broken(view({ image: "tag" }, { name: "x" }))).toBe(
      false,
    );
  });
});

describe("atLeastOne", () => {
  const rule = atLeastOne(["a", "b"], REFUSAL);

  it("is broken when none is given", () => {
    expect(rule.broken(view({}))).toBe(true);
  });

  it("holds when one is given", () => {
    expect(rule.broken(view({ b: "x" }))).toBe(false);
  });
});

describe("refuses", () => {
  it("is broken as its predicate says", () => {
    const rule = refuses((given) => given.flags.runtime === "binary", REFUSAL);

    expect(rule.broken(view({ runtime: "binary" }))).toBe(true);
    expect(rule.broken(view({ runtime: "docker" }))).toBe(false);
  });
});

describe("placeholdersOf", () => {
  it("offers the arguments and the flags by name", () => {
    expect(placeholdersOf(view({ port: 1 }, { name: "x" }))).toEqual({
      port: 1,
      name: "x",
    });
  });
});
