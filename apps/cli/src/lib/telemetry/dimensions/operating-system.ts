import type { Property } from "../property";

/** Maps `process.platform` to Mixpanel's canonical `$os` label. */
class OperatingSystem implements Property<NodeJS.Platform, string> {
  public value(platform: NodeJS.Platform): string {
    switch (platform) {
      case "darwin":
        return "Mac OS X";
      case "win32":
        return "Windows";
      case "linux":
        return "Linux";
      case "freebsd":
      case "openbsd":
      case "netbsd":
        return "BSD";
      case "aix":
        return "AIX";
      case "sunos":
        return "Solaris";
      default:
        return platform;
    }
  }
}

export const operatingSystem = new OperatingSystem();
