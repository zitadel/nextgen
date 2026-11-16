/**
 * The CLI as it is published to npm: which package it is, and which version selector reaches
 * one version of it. A version is either on the release train (`0.1.0`, `1.0.0-alpha.25`), which
 * has exactly its own version to point at, or a prerelease off the train (`1.0.0-beta.2`), which
 * has only its dist-tag.
 */
export class CliPackage {
  /**
   * The package this CLI is published as, which `npx` fetches and runs:
   * `npx @zitadel/cli@1.0.0 deploy`.
   */
  static readonly NAME = "@zitadel/cli";

  /** The CLI's version, without surrounding space or a leading `v`. */
  private readonly version: string;

  /**
   * @param version - The running CLI's version.
   */
  private constructor(version: string) {
    this.version = version.trim().replace(/^v/, "");
  }

  /**
   * One version of the CLI package.
   *
   * @param version - The running CLI's version, e.g. `1.0.0-alpha.25` or `v0.1.0`.
   * @returns The version's package.
   */
  static at(version: string): CliPackage {
    return new CliPackage(version);
  }

  /**
   * Whether a version is one the release train publishes: a release (`0.1.0`) or an alpha
   * prerelease (`1.0.0-alpha.25`). Any other prerelease (`1.0.0-beta.2`, `0.0.0-test`) has only
   * its dist-tag to point at.
   *
   * @param version - A CLI or SDK version.
   * @returns Whether the train publishes exactly this version.
   */
  static isTrain(version: string): boolean {
    return /^\d+\.\d+\.\d+(-alpha\.\d+)?$/.test(version.trim().replace(/^v/, ""));
  }

  /**
   * The npm dist-tag this version is published on: the prerelease's name (`alpha`, `beta`), or
   * `latest` for a release.
   *
   * @returns The dist-tag.
   */
  distTag(): string {
    const match = this.version.match(/^\d+\.\d+\.\d+-([0-9A-Za-z][0-9A-Za-z-]*)/);
    return match?.[1] ?? "latest";
  }

  /**
   * What follows `@` when this version is named: the exact version on the train, else the
   * dist-tag. It is also the version a scaffold writes for the `@zitadel/*` packages it adds: they
   * publish as one lockstep train, so the exact pin keeps the app on the SDK that matches the
   * files this CLI wrote, and lets doctor's `dependency-version` check compare it against the CLI.
   *
   * @returns The version selector.
   */
  selector(): string {
    return CliPackage.isTrain(this.version) ? this.version : this.distTag();
  }
}
