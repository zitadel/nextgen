import { describe, expect, it } from "vitest";

import {
  brandingDesignRules,
  removedSetupDesignRule,
  requestedBrandingDesign,
} from "../../../../../src/lib/oclif/inputs/branding";

function broken(design: unknown) {
  return brandingDesignRules.find((rule) => {
    return rule.broken({
      flags: {
        design,
      },
      args: {},
    });
  });
}

describe("brandingDesignRules", () => {
  it("lets a shipped design and an absent one through", () => {
    expect(broken("centered")).toBeUndefined();
    expect(broken(undefined)).toBeUndefined();
  });

  it("refuses a retired design by name, with the command that replaces it", () => {
    const rule = broken("hero");

    expect(rule?.refusal.message).toBe(
      "The {design} design was retired: it was page layout, not widget structure",
    );
    expect(rule?.refusal.next).toEqual(["branding eject --design centered"]);
  });

  it("refuses an unknown design and lists the catalog", () => {
    const rule = broken("neon");

    expect(rule?.refusal.message).toBe('Unknown design "{design}"');
    expect(rule?.refusal.hint).toBe("Pick one of: centered, minimal.");
  });
});

describe("removedSetupDesignRule", () => {
  it("is broken by any --design", () => {
    expect(removedSetupDesignRule.broken({ flags: { design: "centered" }, args: {} })).toBe(true);
  });

  it("holds without it", () => {
    expect(removedSetupDesignRule.broken({ flags: {}, args: {} })).toBe(false);
  });

  it("points at branding eject", () => {
    expect(removedSetupDesignRule.refusal.next).toEqual(["branding eject"]);
  });
});

describe("requestedBrandingDesign", () => {
  const context = (design: unknown) => {
    return {
      flags: { design },
      args: {},
      meta: {} as never,
      connect: () => Promise.reject(new Error("no connection")),
      resolved: {},
    };
  };

  it("hands over the design that was asked for", async () => {
    await expect(requestedBrandingDesign.resolve(context("minimal"))).resolves.toEqual({
      design: "minimal",
    });
  });

  it("hands over nothing when none was asked for", async () => {
    await expect(requestedBrandingDesign.resolve(context(undefined))).resolves.toEqual({
      design: undefined,
    });
  });
});
