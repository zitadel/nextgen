import { Flags, type Interfaces } from "@oclif/core";
import { describe, expect, it } from "vitest";

import { relatedFlags, relationsOf } from "@/lib/suggestion/relations";

/**
 * A pair of flags where an image is refused beside one runtime only.
 *
 * @returns The flags, as a command declares them.
 */
function runtimeFlags() {
  return relatedFlags(
    {
      image: Flags.string(),
      runtime: Flags.string(),
    },
    {
      image: {
        excludedWhen: {
          flags: ["runtime"],
          when: (flags: Record<string, unknown>) => {
            return flags.runtime === "binary";
          },
        },
      },
    },
  );
}

/**
 * The relationships oclif is handed for a flag.
 *
 * @param name - The flag.
 * @returns Its relationships.
 */
function relationshipsOf(name: "image" | "runtime") {
  const flag = runtimeFlags()[name] as Interfaces.Flag<unknown>;

  return flag.relationships ?? [];
}

describe("relatedFlags", () => {
  describe("excludedWhen", () => {
    it("hands oclif a none-relationship on the flag that carries it", () => {
      expect(relationshipsOf("image")).toMatchObject([
        { type: "none", flags: [{ name: "runtime" }] },
      ]);
    });

    it("leaves the flags it does not name without a relationship", () => {
      expect(relationshipsOf("runtime")).toEqual([]);
    });

    it("applies the exclusion only while the condition holds", async () => {
      const [relationship] = relationshipsOf("image");
      const [excluded] = relationship?.flags ?? [];
      const when = typeof excluded === "string" ? undefined : excluded?.when;

      expect(await when?.({ runtime: "binary" })).toBe(true);
      expect(await when?.({ runtime: "docker" })).toBe(false);
      expect(await when?.({})).toBe(false);
    });

    it("is recorded with the relations a command's flags were declared with", () => {
      expect(relationsOf(runtimeFlags()).image?.excludedWhen?.flags).toEqual(["runtime"]);
    });
  });

  it("refuses a relation that names a flag the command does not declare", () => {
    expect(() => {
      return relatedFlags({ image: Flags.string() }, { runtime: { required: true } } as never);
    }).toThrow("a relation names --runtime, which is not declared");
  });
});
