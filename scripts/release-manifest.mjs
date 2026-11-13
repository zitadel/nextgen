// The registry repository each release pushes its server image to.
export const SERVER_IMAGE = "ghcr.io/zitadel/nextgen";

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
  },
  {
    name: "@zitadel/server",
    dir: "apps/server",
  },
  ...SERVER_PLATFORM_PACKAGES.map((platform) => ({
    name: platform.packageName,
    dir: platform.packageDir,
  })),
  {
    name: "@zitadel/api",
    dir: "packages/api",
  },
  {
    name: "@zitadel/config",
    dir: "packages/config",
  },
  {
    name: "@zitadel/components",
    dir: "packages/components",
  },
  {
    name: "@zitadel/sdk-core",
    dir: "packages/sdk-core",
  },
  {
    name: "@zitadel/sdk-next",
    dir: "packages/sdk-next",
  },
  {
    name: "@zitadel/sdk-nuxt",
    dir: "packages/sdk-nuxt",
  },
  {
    name: "@zitadel/sdk-react",
    dir: "packages/sdk-react",
  },
  {
    name: "@zitadel/sdk-vue",
    dir: "packages/sdk-vue",
  },
  {
    name: "@zitadel/sdk-angular",
    dir: "packages/sdk-angular",
  },
  {
    name: "@zitadel/sdk-solid",
    dir: "packages/sdk-solid",
  },
  {
    name: "@zitadel/sdk-svelte",
    dir: "packages/sdk-svelte",
  },
  {
    name: "@zitadel/sdk-qwik",
    dir: "packages/sdk-qwik",
  },
  {
    name: "@zitadel/sdk-sveltekit",
    dir: "packages/sdk-sveltekit",
  },
  {
    name: "@zitadel/sdk-solid-start",
    dir: "packages/sdk-solid-start",
  },
  {
    name: "@zitadel/sdk-qwik-router",
    dir: "packages/sdk-qwik-router",
  },
  {
    name: "@zitadel/sdk-tanstack-start",
    dir: "packages/sdk-tanstack-start",
  },
  {
    name: "@zitadel/testing",
    dir: "packages/testing",
  },
];

export const PUBLIC_PACKAGE_DIRS = PUBLIC_RELEASE_PACKAGES.map((pkg) => pkg.dir);
export const PUBLIC_PACKAGE_NAMES = PUBLIC_RELEASE_PACKAGES.map((pkg) => pkg.name);

// What `setup` installs into a generated app: the SDKs and the packages they
// depend on, not the CLI, the server or the test kit (which depends on the
// CLI). The contributor CLI wrapper (scripts/run-cli.mjs) publishes only
// these, from their cached dev builds, to its local registry.
export const APP_RELEASE_PACKAGES = PUBLIC_RELEASE_PACKAGES.filter(
  (pkg) =>
    !["@zitadel/cli", "@zitadel/testing"].includes(pkg.name) &&
    !pkg.name.startsWith("@zitadel/server"),
);
