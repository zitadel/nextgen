export const SERVER_PLATFORM_PACKAGES = [
  {
    goos: "linux",
    goarch: "amd64",
    packageName: "@zitadel/server-linux-x64",
    packageDir: "apps/server-linux-x64",
  },
  {
    goos: "linux",
    goarch: "arm64",
    packageName: "@zitadel/server-linux-arm64",
    packageDir: "apps/server-linux-arm64",
  },
  {
    goos: "darwin",
    goarch: "amd64",
    packageName: "@zitadel/server-darwin-x64",
    packageDir: "apps/server-darwin-x64",
  },
  {
    goos: "darwin",
    goarch: "arm64",
    packageName: "@zitadel/server-darwin-arm64",
    packageDir: "apps/server-darwin-arm64",
  },
  {
    goos: "windows",
    goarch: "amd64",
    packageName: "@zitadel/server-win32-x64",
    packageDir: "apps/server-win32-x64",
  },
];

export const PUBLIC_RELEASE_PACKAGES = [
  {
    name: "@zitadel/cli",
    dir: "apps/cli",
    project: "cli",
    dist: true,
  },
  {
    name: "@zitadel/server",
    dir: "apps/server",
    project: "server",
  },
  ...SERVER_PLATFORM_PACKAGES.map((platform) => ({
    name: platform.packageName,
    dir: platform.packageDir,
  })),
  {
    name: "@zitadel/api",
    dir: "packages/api",
    project: "api",
    dist: true,
  },
  {
    name: "@zitadel/config",
    dir: "packages/config",
    project: "config",
    dist: true,
  },
  {
    name: "@zitadel/components",
    dir: "packages/components",
    project: "components",
    dist: true,
  },
  {
    name: "@zitadel/sdk-core",
    dir: "packages/sdk-core",
    project: "sdk-core",
    dist: true,
  },
  {
    name: "@zitadel/sdk-next",
    dir: "packages/sdk-next",
    project: "sdk-next",
    dist: true,
  },
  {
    name: "@zitadel/sdk-nuxt",
    dir: "packages/sdk-nuxt",
    project: "sdk-nuxt",
    dist: true,
  },
  {
    name: "@zitadel/sdk-react",
    dir: "packages/sdk-react",
    project: "sdk-react",
    dist: true,
  },
  {
    name: "@zitadel/sdk-vue",
    dir: "packages/sdk-vue",
    project: "sdk-vue",
    dist: true,
  },
  {
    name: "@zitadel/sdk-angular",
    dir: "packages/sdk-angular",
    project: "sdk-angular",
    dist: true,
  },
  {
    name: "@zitadel/sdk-solid",
    dir: "packages/sdk-solid",
    project: "sdk-solid",
    dist: true,
  },
  {
    name: "@zitadel/sdk-svelte",
    dir: "packages/sdk-svelte",
    project: "sdk-svelte",
    dist: true,
  },
  {
    name: "@zitadel/sdk-qwik",
    dir: "packages/sdk-qwik",
    project: "sdk-qwik",
    dist: true,
  },
  {
    name: "@zitadel/sdk-sveltekit",
    dir: "packages/sdk-sveltekit",
    project: "sdk-sveltekit",
    dist: true,
  },
  {
    name: "@zitadel/sdk-solid-start",
    dir: "packages/sdk-solid-start",
    project: "sdk-solid-start",
    dist: true,
  },
  {
    name: "@zitadel/sdk-qwik-router",
    dir: "packages/sdk-qwik-router",
    project: "sdk-qwik-router",
    dist: true,
  },
  {
    name: "@zitadel/sdk-tanstack-start",
    dir: "packages/sdk-tanstack-start",
    project: "sdk-tanstack-start",
    dist: true,
  },
  {
    name: "@zitadel/testing",
    dir: "packages/testing",
    project: "testing",
    dist: true,
  },
];

export const PUBLIC_PACKAGE_DIRS = PUBLIC_RELEASE_PACKAGES.map((pkg) => pkg.dir);
export const PUBLIC_PACKAGE_NAMES = PUBLIC_RELEASE_PACKAGES.map((pkg) => pkg.name);

/** The server platform package for Node's `platform` and `arch`, by default this machine's. */
export function hostServerPlatformPackage(platform = process.platform, arch = process.arch) {
  const goos = platform === "win32" ? "windows" : platform;
  const goarch = arch === "x64" ? "amd64" : arch;
  const pkg = SERVER_PLATFORM_PACKAGES.find(
    (entry) => entry.goos === goos && entry.goarch === goarch,
  );
  if (!pkg) {
    throw new Error(`no server platform package for ${platform}-${arch}`);
  }
  return pkg;
}

/**
 * What a host-only snapshot packs (`release.mjs snapshot --host-only`): the
 * public packages without the other platforms' server packages.
 */
export function hostOnlyPackageDirs(host = hostServerPlatformPackage()) {
  const others = new Set(
    SERVER_PLATFORM_PACKAGES.filter((entry) => entry.packageDir !== host.packageDir).map(
      (entry) => entry.packageDir,
    ),
  );
  return PUBLIC_PACKAGE_DIRS.filter((dir) => !others.has(dir));
}

// What `setup` installs into a generated app: the SDKs and the packages they
// depend on, not the CLI, the server or the test kit (which depends on the
// CLI). The contributor CLI wrapper (scripts/run-cli.mjs) publishes only
// these, from their cached dev builds, to its local registry.
export const APP_RELEASE_PACKAGES = PUBLIC_RELEASE_PACKAGES.filter(
  (pkg) =>
    !["@zitadel/cli", "@zitadel/testing"].includes(pkg.name) &&
    !pkg.name.startsWith("@zitadel/server"),
);
