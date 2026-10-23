import type { Change, Release } from "./releases";

// What the changelog filters by: the components a change touches, read from
// its packages, and its kind. A breaking change is a major, or a change with a
// paragraph that starts with **Breaking:**, the way one ships as a minor before
// 1.0.0 (docs/adrs/074-preview-releases-on-0x.md). Any other change goes by its
// bump, the release notes' Minor / Patch Changes. A bump is no type (features
// ship as patches, fixes as minors), so the filter names bumps as the release
// notes do.

/** The kinds of change, in the order the page lists them. */
export const KINDS = ["breaking", "minor", "patch"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABELS: Record<Kind, string> = {
  breaking: "Breaking",
  minor: "Minor",
  patch: "Patch",
};

export function kindOf(change: Pick<Change, "bump" | "markedBreaking">): Kind {
  return change.bump === "major" || change.markedBreaking ? "breaking" : change.bump;
}

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

/** The kinds the releases' changes have, in the page's order. */
export function kindsIn(releases: Release[]): Kind[] {
  return KINDS.filter((kind) =>
    releases.some((release) => release.changes.some((change) => kindOf(change) === kind)),
  );
}

/**
 * What the filter reads of an entry: the components it touches and, for a
 * change, its kind. A pointer to a package's left-out changes has no kind.
 */
export type Facet = { components: string[]; kind?: Kind };

export function facetOf(change: Pick<Change, "packages" | "bump" | "markedBreaking">): Facet {
  return {
    components: [...new Set(change.packages.map((pkg) => componentOf(pkg).id))],
    kind: kindOf(change),
  };
}

/** The filter's choice: a component, a kind, both or neither. */
export type Choice = { component?: string; kind?: Kind };

export function matches(facet: Facet, choice: Choice): boolean {
  return (
    (!choice.component || facet.components.includes(choice.component)) &&
    (!choice.kind || !facet.kind || facet.kind === choice.kind)
  );
}
