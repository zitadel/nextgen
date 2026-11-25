export { CliPackage } from "./cli-package";
export {
  UpgradeError,
  UpgradeInstallFailedError,
  UpgradeReleaseLookupError,
} from "./errors";
export { PackageInstaller } from "./installer";
export { Upgrader, type UpgradeResult } from "./upgrader";
export { type BreakingChange, ReleaseNotes } from "./release-notes";
