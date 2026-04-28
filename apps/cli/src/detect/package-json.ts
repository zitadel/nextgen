import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export async function readPackageJson(cwd: string): Promise<PackageJson> {
  const path = join(cwd, "package.json");
  return JSON.parse(await readFile(path, "utf8")) as PackageJson;
}

export function hasDependency(pkg: PackageJson, name: string): boolean {
  return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
}
