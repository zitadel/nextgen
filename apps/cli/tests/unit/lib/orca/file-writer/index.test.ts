import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ZitadelError } from "../../../../../src/lib/errors";
import { scaffold } from "../../../../../src/lib/orca/file-writer/index";
import type { ScaffoldPlan } from "../../../../../src/lib/orca/file-writer/plan";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zitadel-scaffold-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function plan(...ops: ScaffoldPlan["ops"]): ScaffoldPlan {
  return { ops, summary: [] };
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

describe("scaffold - mkdir", () => {
  it("creates a directory recursively", async () => {
    const result = await scaffold(plan({ kind: "mkdir", path: "a/b/c" }), {
      cwd: dir,
      dryRun: false,
      force: false,
    });
    expect(result.filesWritten).toEqual([join(dir, "a/b/c")]);
    expect(await exists(join(dir, "a/b/c"))).toBe(false); // it's a dir, readFile fails
  });

  it("does not touch disk on dry-run but still records the path", async () => {
    const result = await scaffold(plan({ kind: "mkdir", path: "made-up" }), {
      cwd: dir,
      dryRun: true,
      force: false,
    });
    expect(result.dryRun).toBe(true);
    expect(result.filesWritten).toEqual([join(dir, "made-up")]);
  });
});

describe("scaffold - write", () => {
  it("writes a new file with the given contents", async () => {
    const target = join(dir, "src/login/page.tsx");
    const result = await scaffold(
      plan({ kind: "write", path: "src/login/page.tsx", contents: "hello world" }),
      { cwd: dir, dryRun: false, force: false },
    );
    expect(result.filesWritten).toContain(target);
    expect(result.filesSkipped).toEqual([]);
    expect(await readFile(target, "utf8")).toBe("hello world");
  });

  it("is idempotent: a second run skips the unchanged file", async () => {
    const op: ScaffoldPlan["ops"][number] = {
      kind: "write",
      path: "page.tsx",
      contents: "stable",
    };
    await scaffold(plan(op), { cwd: dir, dryRun: false, force: false });
    const second = await scaffold(plan(op), { cwd: dir, dryRun: false, force: false });
    expect(second.filesWritten).toEqual([]);
    expect(second.filesSkipped).toEqual([join(dir, "page.tsx")]);
  });

  it("throws E_CONFLICT when overwriting a different existing file without force", async () => {
    await writeFile(join(dir, "page.tsx"), "user-authored");
    let caught: unknown;
    try {
      await scaffold(plan({ kind: "write", path: "page.tsx", contents: "managed" }), {
        cwd: dir,
        dryRun: false,
        force: false,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ZitadelError);
    expect((caught as ZitadelError).code).toBe("E_CONFLICT");
    // file left untouched
    expect(await readFile(join(dir, "page.tsx"), "utf8")).toBe("user-authored");
  });

  it("overwrites an existing file when force is set", async () => {
    await writeFile(join(dir, "page.tsx"), "old");
    const result = await scaffold(
      plan({ kind: "write", path: "page.tsx", contents: "new" }),
      { cwd: dir, dryRun: false, force: true },
    );
    expect(result.filesWritten).toContain(join(dir, "page.tsx"));
    expect(await readFile(join(dir, "page.tsx"), "utf8")).toBe("new");
  });

  it("does not write to disk on dry-run", async () => {
    const result = await scaffold(
      plan({ kind: "write", path: "page.tsx", contents: "x" }),
      { cwd: dir, dryRun: true, force: false },
    );
    expect(result.filesWritten).toContain(join(dir, "page.tsx"));
    expect(await exists(join(dir, "page.tsx"))).toBe(false);
  });

  it("skips an identical file on dry-run rather than reporting a write", async () => {
    await writeFile(join(dir, "page.tsx"), "same");
    const result = await scaffold(
      plan({ kind: "write", path: "page.tsx", contents: "same" }),
      { cwd: dir, dryRun: true, force: false },
    );
    expect(result.filesSkipped).toEqual([join(dir, "page.tsx")]);
    expect(result.filesWritten).toEqual([]);
  });
});

describe("scaffold - append", () => {
  it("creates the file and appends contents when missing", async () => {
    const result = await scaffold(
      plan({ kind: "append", path: "notes.txt", contents: "line-1" }),
      { cwd: dir, dryRun: false, force: false },
    );
    expect(result.filesWritten).toContain(join(dir, "notes.txt"));
    expect(await readFile(join(dir, "notes.txt"), "utf8")).toBe("line-1");
  });

  it("appends to existing content with a separating newline", async () => {
    await writeFile(join(dir, "notes.txt"), "first");
    await scaffold(plan({ kind: "append", path: "notes.txt", contents: "second" }), {
      cwd: dir,
      dryRun: false,
      force: false,
    });
    expect(await readFile(join(dir, "notes.txt"), "utf8")).toBe("first\nsecond");
  });

  it("skips when ifMissing marker is already present", async () => {
    await writeFile(join(dir, "notes.txt"), "already has MARKER here");
    const result = await scaffold(
      plan({ kind: "append", path: "notes.txt", contents: "x", ifMissing: "MARKER" }),
      { cwd: dir, dryRun: false, force: false },
    );
    expect(result.filesSkipped).toEqual([join(dir, "notes.txt")]);
    expect(await readFile(join(dir, "notes.txt"), "utf8")).toBe("already has MARKER here");
  });
});

describe("scaffold - merge-env", () => {
  it("creates an env file with the given entries", async () => {
    await scaffold(
      plan({ kind: "merge-env", path: ".env.local", entries: { FOO: "1", BAR: "2" } }),
      { cwd: dir, dryRun: false, force: false },
    );
    const text = await readFile(join(dir, ".env.local"), "utf8");
    expect(text).toContain("FOO=1");
    expect(text).toContain("BAR=2");
  });

  it("only adds keys not already present", async () => {
    await writeFile(join(dir, ".env.local"), "FOO=existing\n");
    await scaffold(
      plan({ kind: "merge-env", path: ".env.local", entries: { FOO: "new", BAZ: "3" } }),
      { cwd: dir, dryRun: false, force: false },
    );
    const text = await readFile(join(dir, ".env.local"), "utf8");
    expect(text).toContain("FOO=existing");
    expect(text).not.toContain("FOO=new");
    expect(text).toContain("BAZ=3");
  });

  it("skips when every key is already present", async () => {
    await writeFile(join(dir, ".env.local"), "FOO=1\n");
    const result = await scaffold(
      plan({ kind: "merge-env", path: ".env.local", entries: { FOO: "anything" } }),
      { cwd: dir, dryRun: false, force: false },
    );
    expect(result.filesSkipped).toEqual([join(dir, ".env.local")]);
  });
});

describe("scaffold - merge-json", () => {
  it("creates a JSON file from the patch when none exists", async () => {
    await scaffold(
      plan({ kind: "merge-json", path: "tsconfig.json", patch: { compilerOptions: { strict: true } } }),
      { cwd: dir, dryRun: false, force: false },
    );
    const parsed = JSON.parse(await readFile(join(dir, "tsconfig.json"), "utf8")) as {
      compilerOptions: { strict: boolean };
    };
    expect(parsed.compilerOptions.strict).toBe(true);
  });

  it("deep-merges into existing JSON, preserving untouched keys", async () => {
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { target: "es2020" }, include: ["src"] }),
    );
    await scaffold(
      plan({ kind: "merge-json", path: "tsconfig.json", patch: { compilerOptions: { strict: true } } }),
      { cwd: dir, dryRun: false, force: false },
    );
    const parsed = JSON.parse(await readFile(join(dir, "tsconfig.json"), "utf8")) as {
      compilerOptions: { target: string; strict: boolean };
      include: string[];
    };
    expect(parsed.compilerOptions.target).toBe("es2020");
    expect(parsed.compilerOptions.strict).toBe(true);
    expect(parsed.include).toEqual(["src"]);
  });

  it("is idempotent: re-merging the same patch skips", async () => {
    const p = plan({
      kind: "merge-json",
      path: "tsconfig.json",
      patch: { compilerOptions: { strict: true } },
    });
    await scaffold(p, { cwd: dir, dryRun: false, force: false });
    const second = await scaffold(p, { cwd: dir, dryRun: false, force: false });
    expect(second.filesSkipped).toEqual([join(dir, "tsconfig.json")]);
    expect(second.filesWritten).toEqual([]);
  });
});

describe("scaffold - append-gitignore", () => {
  it("creates .gitignore with the entries", async () => {
    await scaffold(plan({ kind: "append-gitignore", entries: [".env.local", ".zitadel"] }), {
      cwd: dir,
      dryRun: false,
      force: false,
    });
    const text = await readFile(join(dir, ".gitignore"), "utf8");
    expect(text).toContain(".env.local");
    expect(text).toContain(".zitadel");
  });

  it("only appends entries not already listed", async () => {
    await writeFile(join(dir, ".gitignore"), ".env.local\nnode_modules\n");
    await scaffold(
      plan({ kind: "append-gitignore", entries: [".env.local", ".zitadel"] }),
      { cwd: dir, dryRun: false, force: false },
    );
    const text = await readFile(join(dir, ".gitignore"), "utf8");
    expect(text.match(/\.env\.local/g)).toHaveLength(1);
    expect(text).toContain(".zitadel");
  });

  it("skips when all entries are present", async () => {
    await writeFile(join(dir, ".gitignore"), ".zitadel\n");
    const result = await scaffold(
      plan({ kind: "append-gitignore", entries: [".zitadel"] }),
      { cwd: dir, dryRun: false, force: false },
    );
    expect(result.filesSkipped).toEqual([join(dir, ".gitignore")]);
  });
});

describe("scaffold - add-dep", () => {
  it("adds a dependency to package.json and records it in depsAdded", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo" }));
    const result = await scaffold(
      plan({ kind: "add-dep", name: "@zitadel-nextgen/sdk-next", version: "1.2.3" }),
      { cwd: dir, dryRun: false, force: false },
    );
    expect(result.depsAdded).toEqual(["@zitadel-nextgen/sdk-next"]);
    const parsed = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(parsed.dependencies["@zitadel-nextgen/sdk-next"]).toBe("1.2.3");
  });

  it("adds to devDependencies when dev is set", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo" }));
    await scaffold(
      plan({ kind: "add-dep", name: "typescript", version: "5.0.0", dev: true }),
      { cwd: dir, dryRun: false, force: false },
    );
    const parsed = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    expect(parsed.devDependencies["typescript"]).toBe("5.0.0");
  });

  it("skips when the dependency is already at the requested version", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { foo: "1.0.0" } }),
    );
    const result = await scaffold(
      plan({ kind: "add-dep", name: "foo", version: "1.0.0" }),
      { cwd: dir, dryRun: false, force: false },
    );
    expect(result.filesSkipped).toEqual([join(dir, "package.json")]);
    expect(result.depsAdded).toEqual([]);
  });

  it("throws E_VALIDATION when package.json is missing", async () => {
    let caught: unknown;
    try {
      await scaffold(plan({ kind: "add-dep", name: "foo", version: "1.0.0" }), {
        cwd: dir,
        dryRun: false,
        force: false,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ZitadelError);
    expect((caught as ZitadelError).code).toBe("E_VALIDATION");
  });

  it("records the dep but does not write on dry-run", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo" }));
    const result = await scaffold(
      plan({ kind: "add-dep", name: "foo", version: "1.0.0" }),
      { cwd: dir, dryRun: true, force: false },
    );
    expect(result.depsAdded).toEqual(["foo"]);
    const parsed = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(parsed.dependencies).toBeUndefined();
  });
});

describe("scaffold - multi-op plans", () => {
  it("applies ops in order and aggregates the result", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo" }));
    const result = await scaffold(
      plan(
        { kind: "mkdir", path: "app/login" },
        { kind: "write", path: "app/login/page.tsx", contents: "<page />" },
        { kind: "append-gitignore", entries: [".zitadel"] },
        { kind: "add-dep", name: "sdk", version: "1.0.0" },
      ),
      { cwd: dir, dryRun: false, force: false },
    );
    expect(result.filesWritten).toContain(join(dir, "app/login"));
    expect(result.filesWritten).toContain(join(dir, "app/login/page.tsx"));
    expect(result.filesWritten).toContain(join(dir, ".gitignore"));
    expect(result.depsAdded).toEqual(["sdk"]);
    expect(await readFile(join(dir, "app/login/page.tsx"), "utf8")).toBe("<page />");
  });

  it("is fully idempotent: re-running a complete plan writes nothing new", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo" }));
    const full = plan(
      { kind: "mkdir", path: "app" },
      { kind: "write", path: "app/page.tsx", contents: "<page />" },
      { kind: "merge-env", path: ".env.local", entries: { FOO: "1" } },
      { kind: "append-gitignore", entries: [".zitadel"] },
      { kind: "add-dep", name: "sdk", version: "1.0.0" },
    );
    await scaffold(full, { cwd: dir, dryRun: false, force: false });
    const second = await scaffold(full, { cwd: dir, dryRun: false, force: false });
    // mkdir always reports written; the file-backed ops should all skip.
    expect(second.filesSkipped).toContain(join(dir, "app/page.tsx"));
    expect(second.filesSkipped).toContain(join(dir, ".env.local"));
    expect(second.filesSkipped).toContain(join(dir, ".gitignore"));
    expect(second.filesSkipped).toContain(join(dir, "package.json"));
  });
});
