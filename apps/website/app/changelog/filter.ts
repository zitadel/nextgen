import { BUMPS, type Bump, type Change, type Release } from "./releases";

// What the changelog filters by: the components a change touches, read from
// its packages, and its bump, the release notes' Major / Minor / Patch
// Changes. A bump is no type (features ship as patches, fixes as minors), so
// the filter names bumps as the release notes do.

export const BUMP_LABELS: Record<Bump, string> = {
  major: "Major",
  minor: "Minor",
  patch: "Patch",
};

/** A package, or the SDKs, one package each. */
export type Component = { id: string; label: string };

// The components in the order the release notes list their packages (the
// fixed group in .changeset/config.json), named after the packages'
// descriptions. A package not listed here is a component of its own, under
// its name, after these.
const COMPONENTS: Component[] = [
  { id: "cli", label: "CLI" },
  { id: "server", label: "Server" },
  { id: "api", label: "API client" },
  { id: "config", label: "Config" },
  { id: "components", label: "Web components" },
  { id: "sdks", label: "SDKs" },
  { id: "testing", label: "Test kit" },
];

export function componentOf(pkg: string): Component {
  const name = pkg.replace(/^@zitadel\//, "");
  const id = name.startsWith("sdk-") ? "sdks" : name;
  return COMPONENTS.find((component) => component.id === id) ?? { id, label: name };
}

/** Every component the releases change, in the release notes' order. */
export function componentsIn(releases: Release[]): Component[] {
  const found = new Map(
    releases
      .flatMap((release) => release.changes)
      .flatMap((change) => change.packages.map(componentOf))
      .map((component) => [component.id, component]),
  );
  const rank = (id: string) => {
    const index = COMPONENTS.findIndex((component) => component.id === id);
    return index === -1 ? COMPONENTS.length : index;
  };
  return [...found.values()].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

/** The bumps the releases' changes have, the highest first. */
export function bumpsIn(releases: Release[]): Bump[] {
  return BUMPS.filter((bump) =>
    releases.some((release) => release.changes.some((change) => change.bump === bump)),
  );
}

/**
 * What the filter reads of an entry: the components it touches and, for a
 * change, its bump. A pointer to a package's left-out changes has no bump.
 */
export type Facet = { components: string[]; bump?: Bump };

export function facetOf(change: Pick<Change, "packages" | "bump">): Facet {
  return {
    components: [...new Set(change.packages.map((pkg) => componentOf(pkg).id))],
    bump: change.bump,
  };
}

/** The filter's choice: a component, a bump, both or neither. */
export type Choice = { component?: string; bump?: Bump };

export function matches(facet: Facet, choice: Choice): boolean {
  return (
    (!choice.component || facet.components.includes(choice.component)) &&
    (!choice.bump || !facet.bump || facet.bump === choice.bump)
  );
}
