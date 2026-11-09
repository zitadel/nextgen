import { basename, join } from "node:path";

import {
  getDefaultHumanUserSchemaBody,
  type SetupPreset,
  type SetupUseCase,
} from "@zitadel/config/defaults";
import { type ProviderSelection, providerOf } from "@zitadel/config/idp";
import { RECOMMENDED_PASSWORD_MIN_LENGTH } from "@zitadel/config/schemas";
import semver from "semver";

import { pathExists } from "@/lib/fs";
import { applySsoToSchema } from "@/lib/idp/documents";
import { detectors } from "@/lib/orca/detectors";
import type { Detector } from "@/lib/orca/detectors/types";
import { type Fact, type Section as UiSection, section as uiSection } from "@/lib/ui";
import { readPackageJson } from "@/lib/npm";
import { detectPackageManager, type PackageManager } from "@/lib/package-manager";
import { dim } from "@/lib/style";
import type { PasswordMinLength } from "@/lib/policies";

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
            row.secondary === undefined ? row.value : `${row.value} ${dim(`(${row.secondary})`)}`,
          ],
        ),
      ),
    );
}

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
    typescript: await pathExists(join(cwd, "tsconfig.json")),
    packageManager: await detectPackageManager(cwd),
  };
  // A missing or unreadable package.json leaves the version undefined; the
  // renderer skips that segment, which is the same as the user not having
  // declared the framework dep yet.
  const pj = await readPackageJson(cwd).catch(() => undefined);
  const depPkg = depFromFramework(frameworkId);
  const range = pj?.dependencies?.[depPkg] ?? pj?.devDependencies?.[depPkg];
  const version = range ? stripRange(range) : undefined;
  if (version) {
    facts.frameworkVersion = version;
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
  return segments.join(` ${dim("·")} `);
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
 * The sign-in configuration setup's answers add up to, as `data.sign_in`
 * reports it. Read off the schema setup renders rather than inferred from the
 * preset's name: `password-first` enables passkeys too, and a use case's
 * profile fields are optional. It describes what is configured, not that
 * sign-in works: an enabled method is not a credential a user has registered.
 */
export type SignIn = {
  /** The method the login flow's entry step offers. */
  starts_with: "password" | "passkey";
  /** The methods the user schema enables, in the schema's order. */
  methods: string[];
  /** What registration asks for, in order, and whether each is required. */
  fields: { name: string; required: boolean }[];
  /** `null` when passwords have no minimum length. */
  password_min_length: number | null;
  /** The external providers' slugs, in the order they were chosen. */
  providers: string[];
};

export function signInOf(answers: {
  preset: SetupPreset;
  useCase: SetupUseCase;
  sso: ReadonlyArray<{ selection: ProviderSelection }>;
  passwordMinLength?: PasswordMinLength;
}): SignIn {
  // The schema setup publishes: the preset and use case's template with each
  // chosen provider enabled, so `methods` names `sso` when it is on.
  const slugs = answers.sso.map((draft) => providerOf(draft.selection).slug);
  const schema = slugs.reduce<Record<string, unknown>>(
    (document, slug) => applySsoToSchema(document, slug).document,
    getDefaultHumanUserSchemaBody({ preset: answers.preset, useCase: answers.useCase }) as Record<
      string,
      unknown
    >,
  );
  const methods = Object.entries((schema["x-auth-methods"] ?? {}) as Record<string, unknown>)
    .filter(([, value]) => (value as { enabled?: unknown } | null)?.enabled === true)
    .map(([name]) => name);
  const required = new Set((schema.required ?? []) as string[]);
  return {
    starts_with: answers.preset === "passkey-first" ? "passkey" : "password",
    methods,
    fields: Object.keys((schema.properties ?? {}) as Record<string, unknown>).map((name) => ({
      name,
      required: required.has(name),
    })),
    // None given is the recommended minimum, which setup writes in its place.
    password_min_length:
      answers.passwordMinLength === null
        ? null
        : (answers.passwordMinLength ?? RECOMMENDED_PASSWORD_MIN_LENGTH),
    providers: slugs,
  };
}
