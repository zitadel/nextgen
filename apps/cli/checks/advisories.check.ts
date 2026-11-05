import semver from "semver";
import { describe, expect, it } from "vitest";

import { scaffolders } from "../src/lib/orca/scaffolders";

/**
 * Asks the npm advisory database about every package a scaffolder pins
 * (`pinnedPackages`): the versions a fresh app gets until someone bumps the
 * pin. `cli:check-advisories` runs it apart from `cli:test`, because it needs
 * the network and its answer changes when an advisory is published, with no
 * file in this repository changing.
 */

/** The endpoint `npm audit` asks: the advisories that affect the versions it is sent, per package. */
const BULK_ADVISORIES = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";

/** Low and moderate advisories are left to the app's own `npm audit`. */
const BLOCKING = new Set(["high", "critical"]);

interface Advisory {
  readonly title: string;
  readonly url: string;
  readonly severity: string;
  readonly vulnerable_versions: string;
}

const pins = scaffolders.flatMap((scaffolder) =>
  scaffolder.pinnedPackages.map((spec) => {
    const at = spec.lastIndexOf("@");
    const pin = { name: spec.slice(0, at), version: spec.slice(at + 1) };
    return [spec, scaffolder.displayName, pin] as const;
  }),
);

async function advisories(name: string, version: string): Promise<ReadonlyArray<Advisory>> {
  const response = await fetch(BULK_ADVISORIES, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ [name]: [version] }),
  });
  if (!response.ok) {
    throw new Error(`The npm advisory database answered ${String(response.status)}`);
  }
  const byPackage = (await response.json()) as Record<string, ReadonlyArray<Advisory>>;
  return byPackage[name] ?? [];
}

describe("pinned scaffold packages", () => {
  it.each(pins)(
    "%s, pinned by the %s scaffolder, has no high or critical advisory",
    async (_spec, _scaffolder, { name, version }) => {
      const found = await advisories(name, version);

      const blocking = found
        .filter((advisory) => BLOCKING.has(advisory.severity))
        .filter((advisory) =>
          semver.satisfies(version, advisory.vulnerable_versions, { includePrerelease: true }),
        )
        .map((advisory) => `${advisory.severity}: ${advisory.title} (${advisory.url})`);
      expect(blocking).toEqual([]);
    },
  );
});
