import { basename, join } from "node:path";

import type { SetupPreset, SetupUseCase } from "@zitadel/config/defaults";
import semver from "semver";

import { pathExists } from "@/lib/fs";
import { detectors } from "@/lib/orca/detectors";
import {
  type ScaffoldedProvider,
  TOGGLEABLE_METHODS,
  type ToggleableMethod,
  ZitadelConfig,
} from "@/lib/zitadel";
import type { Detector } from "@/lib/orca/detectors/types";
import { readPackageJson } from "@/lib/npm";
import { detectPackageManager, type PackageManager } from "@/lib/package-manager";
import { arrow, dim, mark } from "@/lib/style";
import type { PasswordMinLength } from "@/lib/zitadel";

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
 * in pre-styled — use the palette in `lib/style` to keep the colours
 * consistent with the mock. That is also what spells a value out: this box is
 * written straight to the terminal rather than through `emit`, so a value put
 * in raw reaches the reader as it came.
 */
export function renderSummary(sections: Section[]): string {
  const lines: string[] = [];
  for (const section of sections) {
    if (section.rows.length === 0) continue;
    if (lines.length > 0) lines.push("");
    lines.push(dim(section.title.toUpperCase()));
    const labelWidth = Math.max(...section.rows.map((r) => r.label.length)) + 3;
    for (const row of section.rows) {
      const labelCol = row.label.padEnd(labelWidth);
      const secondary = row.secondary ? `   ${arrow} ${row.secondary}` : "";
      lines.push(`${mark.pass} ${labelCol}${row.value}${secondary}`);
    }
  }
  return lines.join("\n");
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

export function prettyFramework(framework: string): string {
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
  /**
   * The methods the user schema enables: the one sign-in starts with, the
   * other, then `sso` when a provider is on.
   */
  methods: string[];
  /** What registration asks for, in order, and whether each is required. */
  fields: { name: string; required: boolean }[];
  /** `null` when passwords have no minimum length. */
  password_min_length: number | null;
  /** The external providers' slugs, in the order they were chosen. */
  providers: string[];
};

/**
 * The sign-in configuration setup's answers add up to, read off the
 * configuration setup scaffolds for them.
 *
 * @remarks
 * Scaffolded on an empty configuration, so a password policy `--force` keeps
 * is not read: the caller reports the minimum it wrote in its place.
 *
 * @param answers - The preset, use case, providers and minimum password
 *   length setup was given.
 * @returns What sign-in and registration are configured to do.
 */
export function signInOf(answers: {
  preset: SetupPreset;
  useCase: SetupUseCase;
  sso: readonly ScaffoldedProvider[];
  passwordMinLength?: PasswordMinLength;
}): SignIn {
  // The schema setup writes: the preset and use case's template with each
  // chosen provider enabled, so `methods` names `sso` when it is on.
  const scaffolded = ZitadelConfig.empty().scaffold({
    preset: answers.preset,
    useCase: answers.useCase,
    sso: answers.sso,
    passwordMinLength: answers.passwordMinLength,
    force: false,
  });
  const schema = scaffolded.schema;
  const policy = scaffolded.policy;
  const startsWith: ToggleableMethod = answers.preset === "passkey-first" ? "passkey" : "password";
  const order: readonly ToggleableMethod[] = [
    startsWith,
    ...TOGGLEABLE_METHODS.filter((method) => {
      return method !== startsWith;
    }),
  ];
  const required: readonly string[] = schema.requiredPaths;
  return {
    starts_with: startsWith,
    methods: [
      ...order.filter((method) => {
        return schema.enabledMethods[method];
      }),
      ...(schema.isSsoEnabled ? ["sso"] : []),
    ],
    fields: schema.propertyNames.map((name) => {
      return { name, required: required.includes(name) };
    }),
    password_min_length: policy.minLength ?? null,
    providers: [...schema.providers],
  };
}

/** The wizard's closing note: {@link SignIn} as sentences. */
export function signInSummary(signIn: SignIn, providerNames: readonly string[]): string {
  const required = signIn.fields.filter((field) => field.required).map((f) => f.name);
  const optional = signIn.fields.filter((field) => !field.required).map((f) => f.name);
  return [
    signIn.starts_with === "passkey"
      ? "Users see a passkey first, with email and password as the alternative."
      : "Users see email and password first; passkeys are enabled but not shown at sign-in.",
    `${capitalise(listOf(signIn.methods))} ${signIn.methods.length === 1 ? "is" : "are"} enabled in the user schema.`,
    `Registration requires ${listOf(required)}` +
      (optional.length === 0
        ? "."
        : `; ${listOf(optional)} ${optional.length === 1 ? "is" : "are"} optional.`),
    signIn.password_min_length === null
      ? "Passwords have no minimum length."
      : `Passwords need at least ${signIn.password_min_length} characters.`,
    providerNames.length === 0
      ? "No external providers will be added."
      : `External providers: ${providerNames.join(", ")}.`,
  ].join("\n");
}

/** `["a"]` → "a", `["a", "b"]` → "a and b", `["a", "b", "c"]` → "a, b and c". */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function capitalise(text: string): string {
  return text.length > 0 ? `${text[0]?.toUpperCase()}${text.slice(1)}` : text;
}
