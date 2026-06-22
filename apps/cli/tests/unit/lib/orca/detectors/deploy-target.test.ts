import { describe, expect, it } from "vitest";

import {
  detectDeployTarget,
  type DeployTargetProbes,
} from "../../../../../src/lib/orca/detectors/deploy-target";

/** Builds probes from a set of installed CLIs and present config files. */
function probes(installed: string[], configFiles: string[] = []): DeployTargetProbes {
  return {
    isCliInstalled: (cli) => installed.includes(cli),
    configFileExists: (_cwd, file) => configFiles.includes(file),
  };
}

describe("detectDeployTarget", () => {
  it("returns undefined when no platform CLI is installed", () => {
    expect(detectDeployTarget("/app", probes([]))).toBeUndefined();
  });

  it("returns the only installed target", () => {
    expect(detectDeployTarget("/app", probes(["vercel"]))).toBe("vercel");
    expect(detectDeployTarget("/app", probes(["netlify"]))).toBe("netlify");
    expect(detectDeployTarget("/app", probes(["wrangler"]))).toBe("cloudflare");
  });

  it("disambiguates multiple installed CLIs by a present config file", () => {
    expect(
      detectDeployTarget("/app", probes(["wrangler", "vercel", "netlify"], ["netlify.toml"])),
    ).toBe("netlify");
    expect(detectDeployTarget("/app", probes(["wrangler", "vercel"], ["vercel.json"]))).toBe(
      "vercel",
    );
  });

  it("falls back to priority order (cloudflare first) when no config disambiguates", () => {
    expect(detectDeployTarget("/app", probes(["wrangler", "vercel", "netlify"]))).toBe(
      "cloudflare",
    );
    expect(detectDeployTarget("/app", probes(["vercel", "netlify"]))).toBe("vercel");
  });
});
