import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_DEV_PORT,
  detectDevPort,
  extractPort,
  issuerFromPort,
  portFromIssuer,
  withDevPort,
} from "../../../../../src/lib/orca/detectors/port";

describe("extractPort", () => {
  it("parses the -p flag form", () => {
    expect(extractPort("next dev -p 4000")).toBe(4000);
  });

  it("parses the --port=NNNN form", () => {
    expect(extractPort("next dev --port=4100")).toBe(4100);
  });

  it("parses the --port NNNN (space) form", () => {
    expect(extractPort("next dev --port 4200")).toBe(4200);
  });

  it("parses a leading PORT= env assignment", () => {
    expect(extractPort("PORT=4300 next dev")).toBe(4300);
  });

  it("parses a PORT= env assignment preceded by whitespace", () => {
    expect(extractPort("cross-env PORT=4400 next dev")).toBe(4400);
  });

  it("prefers the flag form over a PORT= assignment", () => {
    expect(extractPort("PORT=1111 next dev -p 2222")).toBe(2222);
  });

  it("returns undefined when no port is present", () => {
    expect(extractPort("next dev")).toBeUndefined();
  });

  it("returns undefined for an empty script", () => {
    expect(extractPort("")).toBeUndefined();
  });
});

describe("issuerFromPort", () => {
  it("builds a localhost issuer URL for the given port", () => {
    expect(issuerFromPort(3000)).toBe("http://localhost:3000");
  });

  it("reflects the supplied port", () => {
    expect(issuerFromPort(8080)).toBe("http://localhost:8080");
  });
});

describe("DEFAULT_DEV_PORT", () => {
  it("matches the Next.js default of 3000", () => {
    expect(DEFAULT_DEV_PORT).toBe(3000);
  });
});

describe("detectDevPort", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zitadel-port-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("falls back to DEFAULT_DEV_PORT when nothing is configured", async () => {
    expect(await detectDevPort(dir, {})).toBe(DEFAULT_DEV_PORT);
  });

  it("reads the port from the dev script", async () => {
    expect(await detectDevPort(dir, { scripts: { dev: "next dev -p 4567" } })).toBe(4567);
  });

  it("reads the port from .env.local when the dev script has none", async () => {
    await writeFile(join(dir, ".env.local"), "PORT=5500\n");
    expect(await detectDevPort(dir, { scripts: { dev: "next dev" } })).toBe(5500);
  });

  it("reads the port from .env when .env.local is absent", async () => {
    await writeFile(join(dir, ".env"), "PORT=5600\n");
    expect(await detectDevPort(dir, {})).toBe(5600);
  });

  it("prefers the dev script over an env file PORT", async () => {
    await writeFile(join(dir, ".env.local"), "PORT=8000\n");
    expect(await detectDevPort(dir, { scripts: { dev: "next dev -p 7000" } })).toBe(7000);
  });

  it("prefers .env.local over .env", async () => {
    await writeFile(join(dir, ".env.local"), "PORT=5700\n");
    await writeFile(join(dir, ".env"), "PORT=5800\n");
    expect(await detectDevPort(dir, {})).toBe(5700);
  });
});

describe("withDevPort", () => {
  it("appends the flag when the script declares no port", () => {
    expect(withDevPort("next dev", 3456)).toBe("next dev --port 3456");
    expect(withDevPort("nuxt dev", 4100)).toBe("nuxt dev --port 4100");
  });

  it("keeps other flags intact when appending", () => {
    expect(withDevPort("next dev --turbopack", 3456)).toBe("next dev --turbopack --port 3456");
  });

  it("rewrites an existing port in place, in every form extractPort reads", () => {
    expect(withDevPort("next dev -p 3000", 3456)).toBe("next dev -p 3456");
    expect(withDevPort("next dev --port 3000", 3456)).toBe("next dev --port 3456");
    expect(withDevPort("next dev --port=3000", 3456)).toBe("next dev --port=3456");
    expect(withDevPort("PORT=3000 next dev", 3456)).toBe("PORT=3456 next dev");
  });

  it("is idempotent, so re-running setup does not churn package.json", () => {
    const once = withDevPort("next dev", 3456);
    expect(withDevPort(once, 3456)).toBe(once);
  });

  // The whole point: whatever the script said before, reading it back must
  // yield the port setup registered as the project's allowed origin.
  it("round-trips through extractPort for every input shape", () => {
    for (const script of [
      "next dev",
      "next dev --turbopack",
      "next dev -p 3000",
      "next dev --port=9999",
      "PORT=1234 next dev",
      "nuxt dev",
    ]) {
      expect(extractPort(withDevPort(script, 3456)), script).toBe(3456);
    }
  });
});

describe("portFromIssuer", () => {
  it("round-trips issuerFromPort", () => {
    expect(portFromIssuer(issuerFromPort(3456))).toBe(3456);
  });

  // `--dev-port` accepts 1..65535, and WHATWG canonicalisation drops a port
  // matching the scheme default — so reading `new URL(...).port` would return
  // nothing here and silently disable the dev-script pinning.
  it("keeps an explicitly written scheme-default port", () => {
    expect(portFromIssuer(issuerFromPort(80))).toBe(80);
    expect(portFromIssuer("https://localhost:443")).toBe(443);
  });

  it("reads the port past IPv6 brackets and userinfo", () => {
    expect(portFromIssuer("http://[::1]:80")).toBe(80);
    expect(portFromIssuer("http://[::1]:3456")).toBe(3456);
    expect(portFromIssuer("http://user:pass@localhost:80")).toBe(80);
    expect(portFromIssuer("http://[::1]")).toBeUndefined();
  });

  it("returns undefined when the issuer names no explicit port", () => {
    expect(portFromIssuer("https://auth.example.com")).toBeUndefined();
    expect(portFromIssuer("http://localhost")).toBeUndefined();
  });

  it("returns undefined for a malformed issuer", () => {
    expect(portFromIssuer("")).toBeUndefined();
    expect(portFromIssuer("localhost:3456")).toBeUndefined();
  });
});
