import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The `package.json` fields this package reads. */
export interface PackageJson {
  readonly name?: string;
  readonly version?: string;
  readonly type?: string;
  readonly exports?: unknown;
  readonly sideEffects?: unknown;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly [field: string]: unknown;
}

/** The `package.json` of the package at `root`. */
export function readPackageJson(root: string): PackageJson {
  return JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as PackageJson;
}

/** Whether the package at `root` is an ES module package (`"type": "module"`). */
export function isModulePackage(root: string): boolean {
  return readPackageJson(root).type === "module";
}

/** The manifest fields that name a file consumers load: entry points and type entry points. */
const PUBLISHED_FIELDS = [
  "exports",
  "main",
  "module",
  "types",
  "typings",
  "typesVersions",
] as const;

/** Every string a JSON value holds, nested ones included. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/**
 * Whether the manifest of the package at `root` names `file` (absolute) as something consumers
 * load: an `exports` target, `main`, `module`, `types`, `typings` or a `typesVersions` target. A
 * file it names nowhere is unreachable once published.
 */
export function namesFile(root: string, file: string): boolean {
  const pkg = readPackageJson(root);
  return PUBLISHED_FIELDS.flatMap((field) => strings(pkg[field])).some(
    (target) => resolve(root, target) === resolve(file),
  );
}
