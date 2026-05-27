import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FLOWS_DIR,
  buildFlowAndLocale,
  readLocalFlows,
  validateFlows,
  writeLocalFlow,
} from "../../../../src/lib/flows";
import { ZitadelError } from "../../../../src/lib/errors";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "zitadel-flows-io-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("readLocalFlows", () => {
  it("returns an empty array when the flows directory is missing", async () => {
    expect(await readLocalFlows(cwd)).toEqual([]);
  });

  it("throws E_VALIDATION when requireDir is true and the directory is missing", async () => {
    await expect(readLocalFlows(cwd, { requireDir: true })).rejects.toBeInstanceOf(ZitadelError);
  });

  it("returns parsed flows for valid JSON files", async () => {
    const { flow } = buildFlowAndLocale("password", { fields: ["email"] });
    await mkdir(join(cwd, FLOWS_DIR), { recursive: true });
    await writeFile(join(cwd, FLOWS_DIR, "default.json"), JSON.stringify(flow));
    const result = await readLocalFlows(cwd);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("default");
  });

  it("reads files in lexical order", async () => {
    const { flow: a } = buildFlowAndLocale("password", { fields: ["email"] });
    const { flow: b } = buildFlowAndLocale("passkey", { fields: ["email"] });
    const renamed = { ...a, name: "a-flow" };
    const renamed2 = { ...b, name: "b-flow" };
    await mkdir(join(cwd, FLOWS_DIR), { recursive: true });
    await writeFile(join(cwd, FLOWS_DIR, "b.json"), JSON.stringify(renamed2));
    await writeFile(join(cwd, FLOWS_DIR, "a.json"), JSON.stringify(renamed));
    const result = await readLocalFlows(cwd);
    expect(result.map((f) => f.name)).toEqual(["a-flow", "b-flow"]);
  });

  it("throws E_VALIDATION when a file is not valid JSON", async () => {
    await mkdir(join(cwd, FLOWS_DIR), { recursive: true });
    await writeFile(join(cwd, FLOWS_DIR, "bad.json"), "{not json");
    await expect(readLocalFlows(cwd)).rejects.toBeInstanceOf(ZitadelError);
  });

  it("does not validate schema — schema-invalid bodies pass through and are caught by validateFlows", async () => {
    await mkdir(join(cwd, FLOWS_DIR), { recursive: true });
    await writeFile(
      join(cwd, FLOWS_DIR, "bad.json"),
      JSON.stringify({ name: "bad", purposes: [] }),
    );
    const result = await readLocalFlows(cwd);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: "bad", purposes: [] });
    expect(() => validateFlows(result)).toThrow(ZitadelError);
  });

  it("preserves unknown top-level keys so preflight scans see custom placeholders", async () => {
    const { flow } = buildFlowAndLocale("password", { fields: ["email"] });
    const augmented = { ...flow, "x-custom-secret_env": "MY_SECRET" };
    await mkdir(join(cwd, FLOWS_DIR), { recursive: true });
    await writeFile(join(cwd, FLOWS_DIR, "default.json"), JSON.stringify(augmented));
    const result = await readLocalFlows(cwd);
    expect(result[0]["x-custom-secret_env"]).toBe("MY_SECRET");
  });

  it("rejects JSON arrays and primitives at the root", async () => {
    await mkdir(join(cwd, FLOWS_DIR), { recursive: true });
    await writeFile(join(cwd, FLOWS_DIR, "bad.json"), JSON.stringify([]));
    await expect(readLocalFlows(cwd)).rejects.toBeInstanceOf(ZitadelError);
  });

  it("ignores non-JSON files in the directory", async () => {
    const { flow } = buildFlowAndLocale("password", { fields: ["email"] });
    await mkdir(join(cwd, FLOWS_DIR), { recursive: true });
    await writeFile(join(cwd, FLOWS_DIR, "default.json"), JSON.stringify(flow));
    await writeFile(join(cwd, FLOWS_DIR, "README.md"), "not a flow");
    const result = await readLocalFlows(cwd);
    expect(result).toHaveLength(1);
  });
});

describe("validateFlows", () => {
  it("returns the parsed flows on success", () => {
    const { flow } = buildFlowAndLocale("password", { fields: ["email"] });
    expect(validateFlows([flow])).toHaveLength(1);
  });

  it("throws E_VALIDATION when any input fails to parse", () => {
    const { flow } = buildFlowAndLocale("password", { fields: ["email"] });
    expect(() => validateFlows([flow, { name: "bad" }])).toThrow(ZitadelError);
  });

  it("returns an empty array for an empty input", () => {
    expect(validateFlows([])).toEqual([]);
  });
});

describe("writeLocalFlow", () => {
  it("creates the flows directory and writes a canonical JSON file", async () => {
    const { flow } = buildFlowAndLocale("password", { fields: ["email"] });
    await writeLocalFlow(cwd, "default", flow);
    const contents = await readFile(join(cwd, FLOWS_DIR, "default.json"), "utf8");
    expect(contents.endsWith("\n")).toBe(true);
    expect(JSON.parse(contents).name).toBe("default");
  });

  it("round-trips through readLocalFlows", async () => {
    const { flow } = buildFlowAndLocale("passkey", { fields: ["email", "given_name"] });
    await writeLocalFlow(cwd, "default", flow);
    const round = await readLocalFlows(cwd);
    expect(round).toHaveLength(1);
    expect(round[0]).toEqual(flow);
  });
});
