import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import type { SetupPreset } from "@zitadel/config/defaults";
import { type ProviderSelection, providerOf } from "@zitadel/config/idp";
import pc from "picocolors";
import semver from "semver";

import { detectors } from "../../lib/orca/detectors";
import type { Detector } from "../../lib/orca/detectors/types";
import { type Fact, type Section as UiSection, section as uiSection } from "../../lib/ui";
import { detectPackageManager, type PackageManager } from "../../lib/package-manager";
import { type PasswordMinLength, RECOMMENDED_PASSWORD_MIN_LENGTH } from "../../lib/policies";

/**
 * Structured end-of-command summary: one row per fact, grouped under a
 * heading. Each {@link Row} carries the label, the primary value (already
 * styled by the caller), and an optional `secondary` — where to look next for
 * that row, said in the value rather than in a column of its own, because a
 * second column only lines up when every value in the group is the same width.
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
 * The section list as the facts every other command's box states: a heading,
 * then `label   value` rows the shared layout aligns ({@link UiSection}).
 *
 * Setup used to render these itself, with a green `✓` on every row and
 * SCREAMING headings no other box had, and a `→ secondary` column that only
 * lined up when a group's values happened to be the same width. The facts are
 * the same facts; drawing them through the one layout is what makes setup's
 * ending comparable with every other command's at a glance.
 */
export function summarySections(sections: Section[]): UiSection[] {
  return sections
    .filter((section) => section.rows.length > 0)
    .map((section) =>
      uiSection(
        section.title,
        ...section.rows.map(
          (row): Fact => [
            row.label,
            row.secondary === undefined
              ? row.value
              : `${row.value} ${pc.dim(`(${row.secondary})`)}`,
          ],
        ),
      ),
    );
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
    const version = range ? stripRange(range) : undefined;
    if (version) {
      facts.frameworkVersion = version;
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

function detectorFor(framework: string): Detector | undefined {
  return detectors.find((detector) => detector.framework === framework);
}

function depFromFramework(framework: string): string {
  return detectorFor(framework)?.versionPackage ?? framework;
}

function prettyFramework(framework: string): string {
  return detectorFor(framework)?.displayName ?? framework;
}

/**
 * Reduces a declared npm range to the version the summary shows: the lowest
 * version it admits (`semver.minVersion`), so `^15.0.0`, `>= 15.0.0`,
 * `=15.0.0`, `^15.0.0 || ^14.0.0` all read `15.0.0` and `20.1.x` reads
 * `20.1.0`. Returns `undefined` when the spec is not a valid semver range
 * (`catalog:`, `workspace:*`, `file:`, git URLs, dist-tags such as `latest`) or
 * names no version (`*`), because printing that as the framework version would
 * be wrong.
 */
function stripRange(range: string): string | undefined {
  if (!/\d/.test(range) || semver.validRange(range) === null) return undefined;
  return semver.minVersion(range)?.version;
}

/** Returns just the file name from a relative path, for the `→ filename` secondary detail in PACKAGE rows. */
export function fileNameOf(p: string): string {
  return basename(p);
}

/**
 * The sign-in configuration the wizard's answers add up to, said once so the
 * preset, the password policy and the providers need not be pieced together.
 * It describes what will be configured, not that sign-in works: an enabled
 * method is not a credential a user has registered. Both presets enable
 * password and passkey in the schema and differ in which the login flow starts
 * with.
 */
export function signInSummary(answers: {
  preset: SetupPreset;
  sso: ReadonlyArray<{ selection: ProviderSelection }>;
  passwordMinLength?: PasswordMinLength;
}): string {
  const providers = answers.sso.map((draft) => providerOf(draft.selection).displayName);
  return [
    answers.preset === "passkey-first"
      ? "Sign-in starts with a passkey, with email and password as the fallback."
      : "Sign-in starts with email and password.",
    "Password and passkey are enabled in the user schema.",
    // None given is the recommended minimum, which setup writes in its place.
    answers.passwordMinLength === null
      ? "Passwords have no minimum length."
      : `Passwords need at least ${answers.passwordMinLength ?? RECOMMENDED_PASSWORD_MIN_LENGTH} characters.`,
    providers.length === 0
      ? "No external providers will be added."
      : `External providers: ${providers.join(", ")}.`,
  ].join("\n");
}
