import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_DEV_PORT,
  detectDevPort,
  extractPort,
  issuerFromPort,
} from "../../../src/detect/port";

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
    expect(await detectDevPort(dir)).toBe(DEFAULT_DEV_PORT);
  });

  it("reads the port from the package.json dev script", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { dev: "next dev -p 4567" } }),
    );
    expect(await detectDevPort(dir)).toBe(4567);
  });

  it("reads the port from .env.local when the dev script has none", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { dev: "next dev" } }),
    );
    await writeFile(join(dir, ".env.local"), "PORT=5500\n");
    expect(await detectDevPort(dir)).toBe(5500);
  });

  it("reads the port from .env when .env.local is absent", async () => {
    await writeFile(join(dir, ".env"), "PORT=5600\n");
    expect(await detectDevPort(dir)).toBe(5600);
  });

  it("prefers the dev script over an env file PORT", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { dev: "next dev -p 7000" } }),
    );
    await writeFile(join(dir, ".env.local"), "PORT=8000\n");
    expect(await detectDevPort(dir)).toBe(7000);
  });

  it("prefers .env.local over .env", async () => {
    await writeFile(join(dir, ".env.local"), "PORT=5700\n");
    await writeFile(join(dir, ".env"), "PORT=5800\n");
    expect(await detectDevPort(dir)).toBe(5700);
  });

  it("falls back to default when package.json is missing or malformed", async () => {
    await writeFile(join(dir, "package.json"), "{not json");
    expect(await detectDevPort(dir)).toBe(DEFAULT_DEV_PORT);
  });
});
