import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import type { BrandingDesign } from "@zitadel/config/defaults";
import pc from "picocolors";

import { detectPackageManager, type PackageManager } from "../../lib/package-manager";

/**
 * Structured end-of-command summary, modelled on the report layout the
 * setup mock specifies: one line per fact, grouped under uppercase section
 * headers, with consistent `✓ label value` formatting. Each {@link Row}
 * carries the label, the primary value (already styled by the caller),
 * and an optional `secondary` shown after a dim `→` to mirror the
 * "package → file" lines in the mock.
 */
export type Row = {
  label: string;
  value: string;
  secondary?: string;
};

export type Section = {
  title: string;
  rows: Row[];
};

/**
 * Renders a path under `cwd` with stable POSIX separators. Setup's summary
 * matches generated artifacts against repository-style suffixes such as
 * `.zitadel/schemas/default-human-user.json`; normalizing here keeps those
 * matches working when Node returns Windows paths with backslashes.
 */
export function relativeDisplayPath(cwd: string, absolute: string): string {
  const boundary = absolute[cwd.length];
  const withinCwd = absolute.startsWith(cwd) && (boundary === "/" || boundary === "\\");
  const display = withinCwd ? absolute.slice(cwd.length + 1) : absolute;
  return display.replaceAll("\\", "/");
}

/**
 * Renders the section list as a single multi-line string. Labels are
 * padded to a common width per section so the `✓ label  value` columns
 * line up, the title prints in dim gray, and `✓` is green. Values come
 * in pre-styled — use the helpers below ({@link path}, {@link url},
 * {@link id}, {@link dim}) to keep the colour palette consistent with
 * the mock.
 */
export function renderSummary(sections: Section[]): string {
  const lines: string[] = [];
  for (const section of sections) {
    if (section.rows.length === 0) continue;
    if (lines.length > 0) lines.push("");
    lines.push(pc.dim(section.title.toUpperCase()));
    const labelWidth = Math.max(...section.rows.map((r) => r.label.length)) + 3;
    for (const row of section.rows) {
      const labelCol = row.label.padEnd(labelWidth);
      const secondary = row.secondary ? `   ${pc.dim("→")} ${row.secondary}` : "";
      lines.push(`${pc.green("✓")} ${labelCol}${row.value}${secondary}`);
    }
  }
  return lines.join("\n");
}

/** Cyan, for filesystem paths the user can open. */
export const path = (s: string): string => pc.cyan(s);
/** Cyan, for URLs (browser-clickable in most terminals). */
export const url = (s: string): string => pc.cyan(s);
/** Yellow, for opaque ids the user shouldn't try to read. */
export const id = (s: string): string => pc.yellow(s);
/** Dim, for separators and secondary detail. */
export const dim = (s: string): string => pc.dim(s);

/**
 * Detected facts about the user's project, surfaced in the `DETECTED`
 * section. {@link detectProjectFacts} reads the on-disk markers (lock
 * file, tsconfig, framework dep version) without any platform call.
 */
export type ProjectFacts = {
  framework: string;
  frameworkVersion?: string;
  typescript: boolean;
  packageManager: PackageManager;
};

/**
 * Reads the project root to identify the framework version, TS presence,
 * and which package manager the user runs. Returns safe defaults (npm
 * fallback, no version) on any error so summary rendering can always proceed.
 */
export async function detectProjectFacts(cwd: string, frameworkId: string): Promise<ProjectFacts> {
  const facts: ProjectFacts = {
    framework: frameworkId,
    typescript: await fileExists(join(cwd, "tsconfig.json")),
    packageManager: await detectPackageManager(cwd),
  };
  try {
    const raw = await readFile(join(cwd, "package.json"), "utf8");
    const pj = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const depPkg = depFromFramework(frameworkId);
    const range = pj.dependencies?.[depPkg] ?? pj.devDependencies?.[depPkg];
    if (range) {
      facts.frameworkVersion = stripRange(range);
    }
  } catch {
    // Missing or unreadable package.json — version stays undefined; the
    // renderer skips that segment, which is the same as the user not
    // having declared the framework dep yet.
  }
  return facts;
}

/** Formats the project facts as the "Next.js 15 · TypeScript · npm" string the mock shows. */
export function formatFrameworkLine(facts: ProjectFacts): string {
  const segments: string[] = [];
  const pretty = prettyFramework(facts.framework);
  segments.push(facts.frameworkVersion ? `${pretty} ${facts.frameworkVersion}` : pretty);
  if (facts.typescript) segments.push("TypeScript");
  segments.push(facts.packageManager);
  return segments.join(` ${pc.dim("·")} `);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function depFromFramework(framework: string): string {
  switch (framework) {
    case "next":
      return "next";
    case "nuxt":
      return "nuxt";
    default:
      return framework;
  }
}

function prettyFramework(framework: string): string {
  switch (framework) {
    case "next":
      return "Next.js";
    case "nuxt":
      return "Nuxt";
    default:
      return framework;
  }
}

/** Strips `^`/`~`/`>=`/`v` prefixes from an npm range so the version reads cleanly in the summary. */
function stripRange(range: string): string {
  const trimmed = range.replace(/^([\^~]|>=?|v)/, "").trim();
  // Take the first dotted segment so multi-range strings (`^15.0.0 || ^14.0.0`)
  // collapse to a single readable version in the report.
  const first = trimmed.split(/\s+/)[0];
  return first ?? trimmed;
}

/** Returns just the file name from a relative path, for the `→ filename` secondary detail in PACKAGE rows. */
export function fileNameOf(p: string): string {
  return basename(p);
}

/**
 * Layout caveats for the chosen login design, shown to humans after the
 * summary box and carried in the JSON envelope's `warnings`.
 *
 * The split family's brand pane is keyed to the **login's own container**
 * width — a `@container (max-width: 48rem)` query on the widget's mount, not
 * a viewport media query. Above that the pane renders; below it the pane is
 * `display: none` and the compact brand mark takes its place — and the split
 * template only emits that mark when `branding.json` names `logo_url` or
 * `hero_url`, so without one the narrow layout loses the branding entirely.
 *
 * Independent of posture, because the container query is: a full-page login
 * hits the same collapse on a phone that an embedded card hits in a sidebar.
 * Gating on `widget` would have been a guess about the container, and a wrong
 * one in both directions — the wrapper setup scaffolds for a widget is
 * full-width (the pane renders there), and a page-posture login on a phone is
 * exactly the narrow case the advice is for. `hero` stays quiet: its compact
 * fallback is editable text, so a narrow container never leaves it blank.
 */
export function designWarnings(design?: BrandingDesign): string[] {
  if (design !== "split" && design !== "split-right") {
    return [];
  }
  return [
    `The ${design} design shows its brand pane only when the login's container is wide; a narrow container — a card-width embed, or any phone-width viewport — collapses it to the compact brand mark. Set logo_url (or hero_url) in .zitadel/branding/branding.json so that mark isn't empty.`,
  ];
}
