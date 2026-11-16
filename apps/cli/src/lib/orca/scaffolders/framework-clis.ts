import pins from "./framework-clis/package.json";

/**
 * A framework CLI a scaffolder runs, by its npm name. Each runs at the exact
 * version `framework-clis/package.json` pins, never a dist-tag: a release that
 * reached a fresh app the day it shipped broke setup more than once
 * (`create-vite` 9.3.2 shipped without its templates), and the fresh-app
 * journeys run the very version customers get, so an upstream release reaches
 * neither until a pull request has tested it.
 *
 * Dependabot raises each bump there as a pull request of its own
 * (`.github/dependabot.yml`). A bump changes what setup scaffolds, so it needs
 * a changeset. The pins are also checked against the npm advisory database
 * (`pinnedPackages`, `@zitadel/cli#check-advisories`).
 */
export type FrameworkCli = keyof typeof pins.dependencies;

/** The version setup runs a framework CLI at: `4.0.3` for `nuxi`. */
export function frameworkCliVersion(name: FrameworkCli): string {
  return pins.dependencies[name];
}

/** The npm spec setup runs a framework CLI as: `nuxi@4.0.3`. */
export function frameworkCli(name: FrameworkCli): string {
  return `${name}@${frameworkCliVersion(name)}`;
}
