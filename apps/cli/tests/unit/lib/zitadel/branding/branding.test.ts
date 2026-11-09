import { describe, expect, it } from "vitest";

import { Branding, ConfigError } from "@/lib/zitadel";
import { MemoryStore } from "@/lib/zitadel/storage";
import type { Issue } from "@/lib/zitadel/rules/types";
import type { JsonObject } from "@/lib/zitadel/types";

/**
 * Where the descriptor in these tests sits.
 */
const PATH = ".zitadel/branding/branding.json";

/**
 * A template the server's template rules take.
 */
const TEMPLATE = "<zl-page-shell>{% mandatory_gates %}</zl-page-shell>";

/**
 * A descriptor read from `.zitadel/branding/`.
 *
 * @param body - What the file holds.
 * @returns The descriptor, as read.
 */
function brandingOf(body: JsonObject): Branding {
  return Branding.of({ path: PATH, body });
}

/**
 * A store holding a template beside the descriptor.
 *
 * @param template - What `login.liquid` holds.
 * @returns The store.
 */
function storeWith(template: string): MemoryStore {
  return new MemoryStore([], { ".zitadel/branding/login.liquid": template });
}

/**
 * The rules some findings break, in order.
 *
 * @param issues - The findings.
 * @returns Each finding's rule.
 */
function rulesOf(issues: readonly Issue[]): readonly string[] {
  return issues.map((issue) => {
    return issue.rule;
  });
}

describe("Branding.of", () => {
  it("takes the file as read", () => {
    expect(brandingOf({ layout: "centered" }).status).toBe("read");
  });
});

describe("Branding.create", () => {
  it("takes the file as new", () => {
    expect(Branding.create({ path: PATH, body: { layout: "centered" } }).status).toBe("created");
  });
});

describe("Branding.asRead", () => {
  it("marks a new descriptor as read", () => {
    const branding = Branding.create({ path: PATH, body: { layout: "centered" } });

    expect(branding.asRead().status).toBe("read");
  });
});

describe("Branding.problems", () => {
  it("finds nothing wrong with an inline template the server's rules take", () => {
    const branding = brandingOf({ layout: "centered", liquid_template: TEMPLATE });

    expect(branding.problems({ store: new MemoryStore() })).toEqual([]);
  });

  it("finds nothing wrong with a template read through a $file reference", () => {
    const branding = brandingOf({
      layout: "centered",
      liquid_template: { $file: "./login.liquid" },
    });

    expect(branding.problems({ store: storeWith(TEMPLATE) })).toEqual([]);
  });

  it("tells a descriptor with the retired key how to migrate", () => {
    const branding = brandingOf({ layout: "centered", liquid_template_file: "./brand.liquid" });

    expect(branding.problems({})).toEqual([
      {
        severity: "error",
        rule: "branding/legacy-template-key",
        file: PATH,
        message:
          'liquid_template_file is no longer supported. Replace it with "liquid_template": { "$file": "./brand.liquid" }.',
      },
    ]);
  });

  it("points a retired key that names no path at login.liquid", () => {
    const branding = brandingOf({ layout: "centered", liquid_template_file: true });

    expect(
      branding.problems({}).map((issue) => {
        return issue.message;
      }),
    ).toEqual([
      'liquid_template_file is no longer supported. Replace it with "liquid_template": { "$file": "./login.liquid" }.',
    ]);
  });

  it("reports what the branding contract refuses, under contract/branding", () => {
    const branding = brandingOf({ layout: "sideways" });

    expect(rulesOf(branding.problems({}))).toEqual(["contract/branding"]);
  });

  it("reports a $file reference that cannot be read", () => {
    const branding = brandingOf({
      layout: "centered",
      liquid_template: { $file: "./missing.liquid" },
    });

    expect(rulesOf(branding.problems({ store: new MemoryStore() }))).toEqual([
      "branding/template-file",
    ]);
  });

  it("holds the template to the server's template rules", () => {
    const branding = brandingOf({
      layout: "centered",
      liquid_template: "<zl-page-shell></zl-page-shell>",
    });

    expect(rulesOf(branding.problems({ store: new MemoryStore() }))).toEqual(["branding/template"]);
  });

  it("skips the template checks without a store", () => {
    const branding = brandingOf({
      layout: "centered",
      liquid_template: "<zl-page-shell></zl-page-shell>",
    });

    expect(branding.problems({})).toEqual([]);
  });
});

describe("Branding.wireBody", () => {
  it("inlines a $file reference and drops the $schema pointer", () => {
    const branding = brandingOf({
      $schema: "../meta/branding.json",
      layout: "centered",
      liquid_template: { $file: "./login.liquid" },
    });

    expect(branding.wireBody(storeWith(TEMPLATE))).toEqual({
      layout: "centered",
      liquid_template: TEMPLATE,
    });
  });

  it("leaves out a reference that cannot be read", () => {
    const branding = brandingOf({
      layout: "centered",
      liquid_template: { $file: "./missing.liquid" },
    });

    expect(branding.wireBody(new MemoryStore())).toEqual({ layout: "centered" });
  });
});

describe("Branding.template", () => {
  it("reads the template behind a $file reference", () => {
    const branding = brandingOf({ liquid_template: { $file: "./login.liquid" } });

    expect(branding.template(storeWith(TEMPLATE))).toBe(TEMPLATE);
  });

  it("is undefined for a descriptor with no template", () => {
    expect(brandingOf({ layout: "centered" }).template(new MemoryStore())).toBeUndefined();
  });

  it("throws for a reference that cannot be read", () => {
    const branding = brandingOf({ liquid_template: { $file: "./missing.liquid" } });

    expect(() => {
      return branding.template(new MemoryStore());
    }).toThrow(ConfigError);
  });
});

describe("Branding.referencedPaths", () => {
  it("names the files the references point at", () => {
    const branding = brandingOf({ liquid_template: { $file: "./login.liquid" } });

    expect(branding.referencedPaths(new MemoryStore())).toEqual([".zitadel/branding/login.liquid"]);
  });
});
