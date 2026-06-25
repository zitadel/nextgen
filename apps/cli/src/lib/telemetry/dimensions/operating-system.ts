import type { Property } from "../property";

/** Maps `process.platform` to Mixpanel's canonical `$os` label. */
class OperatingSystem implements Property<NodeJS.Platform, string> {
  private static readonly labels: Partial<Record<NodeJS.Platform, string>> = {
    darwin: "Mac OS X",
    win32: "Windows",
    linux: "Linux",
    freebsd: "BSD",
    openbsd: "BSD",
    netbsd: "BSD",
    aix: "AIX",
    sunos: "Solaris",
  };

  public value(platform: NodeJS.Platform): string {
    return OperatingSystem.labels[platform] ?? platform;
  }
}

export const operatingSystem = new OperatingSystem();
