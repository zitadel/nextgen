import type { Change, Notice, Release } from "./releases";

// What the changelog reads of a change: whether it breaks, and the component
// it is listed under. A breaking change is a major, or a change with a
// paragraph that starts with **Breaking:**, the way one ships as a minor before
// 1.0.0 (docs/adrs/074-preview-releases-on-0x.md). The page names no other
// kind: a bump is no type (features ship as patches, fixes as minors), so the
// release notes' Minor / Patch Changes tell a reader nothing.

export function isBreaking(change: Pick<Change, "bump" | "markedBreaking">): boolean {
  return change.bump === "major" || change.markedBreaking;
}

/** A package, or the SDKs, one package each. */
export type Component = { id: string; label: string };

// The components in the order the page lists them, named after the packages'
// descriptions; the console ships in the server. A change to several is listed
// under the first of them here: the surface a reader works with (the CLI, the
// login's web components, an SDK) before the server behind it, and the
// generated API client and config schemas, which change along with another,
// last. A package not listed here is a component of its own, under its name,
// after these.
const COMPONENTS: Component[] = [
  { id: "cli", label: "CLI" },
  { id: "components", label: "Web components" },
  { id: "sdks", label: "SDKs" },
  { id: "server", label: "Server and console" },
  { id: "testing", label: "Test kit" },
  { id: "api", label: "API client" },
  { id: "config", label: "Config" },
];

/** Where a change without a package goes, which the release notes never write. */
const OTHER: Component = { id: "other", label: "Other" };

export function componentOf(pkg: string): Component {
  const name = pkg.replace(/^@zitadel\//, "");
  const id = name.startsWith("sdk-") ? "sdks" : name;
  return COMPONENTS.find((component) => component.id === id) ?? { id, label: name };
}

function rank({ id }: Component): number {
  const index = COMPONENTS.findIndex((component) => component.id === id);
  return index === -1 ? COMPONENTS.length + (id === OTHER.id ? 1 : 0) : index;
}

function byRank(a: Component, b: Component): number {
  return rank(a) - rank(b) || a.id.localeCompare(b.id);
}

/** A component's changes in a release, and what the release says of others it left out. */
export type Group = { component: Component; changes: Change[]; notices: Notice[] };

/**
 * A release's changes by component, in the page's order: each change once,
 * under the first component it touches, and a pointer to a package's left-out
 * changes under that package's component. A notice for no package is no
 * group's.
 */
export function groupByComponent({
  changes,
  notices,
}: Pick<Release, "changes" | "notices">): Group[] {
  const groups = new Map<string, Group>();
  const groupOf = (component: Component) => {
    const group = groups.get(component.id) ?? { component, changes: [], notices: [] };
    groups.set(component.id, group);
    return group;
  };
  for (const change of changes) {
    const [first = OTHER] = change.packages.map(componentOf).sort(byRank);
    groupOf(first).changes.push(change);
  }
  for (const notice of notices) {
    if (notice.package) groupOf(componentOf(notice.package)).notices.push(notice);
  }
  return [...groups.values()].sort((a, b) => byRank(a.component, b.component));
}

/**
 * A summary's first paragraph: up to its first blank line, unless that falls
 * inside a fenced code block, where it is the whole summary.
 */
export function firstParagraph(summary: string): string {
  const [first = summary] = summary.split(/\n[ \t]*\n/, 1);
  const fences = first.match(/^[ \t]*(?:```|~~~)/gm)?.length ?? 0;
  return fences % 2 === 0 ? first : summary;
}
