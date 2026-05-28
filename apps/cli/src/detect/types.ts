/**
 * Frameworks the CLI knows how to wire up. V1 supports only Next.js; the type
 * stays a union so adding frameworks later is a single-point change.
 */
export type FrameworkId = "next";

/**
 * Resolved framework facts the downstream adapters need. `appDir` records where
 * the App Router lives so generated files land in the right place.
 */
export type FrameworkDetection = {
  id: FrameworkId;
  appDir: "app" | "src/app";
};

/**
 * Minimal shape of the `package.json` fields the CLI reads. Intentionally
 * partial: only the keys detection logic depends on are modeled, all optional
 * since a project may omit any of them.
 */
export type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
