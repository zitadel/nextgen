import assert from "node:assert/strict";
import { test } from "vitest";

import {
  edgeProblems,
  ignoredProblems,
  literalsOf,
  namedPaths,
  referenceProblems,
  taskGraph,
} from "./check-turbo-graph.mjs";

test("literalsOf takes module specifiers and fs or path arguments, not data or comments", () => {
  const source = `
    import { a } from "../../scripts/a.mjs";
    export * from "./b";
    // readFileSync("docs/not-read.md")
    const files = ["docs/listed-as-data.md"];
    const text = readFileSync(join(repoRoot, "docs/read.md"), "utf8");
    const url = new URL(\`../defaults/\${name}\`, import.meta.url);
    await import("./lazy.mjs");
    vi.mock("../mocked.ts");
  `;
  assert.deepEqual(literalsOf("pkg/src/x.ts", source), [
    { text: "../../scripts/a.mjs", kind: "import" },
    { text: "./b", kind: "import" },
    { text: "utf8", kind: "read" },
    { text: "docs/read.md", kind: "read" },
    { text: "../defaults/", kind: "read" },
    { text: "./lazy.mjs", kind: "import" },
    { text: "../mocked.ts", kind: "import" },
  ]);
});

test("literalsOf takes Go embeds and the string arguments of fs and path calls", () => {
  const source = [
    "package x",
    "//go:embed page.html all:dist",
    "var page string",
    '// os.ReadFile("not-read.json")',
    'var name = "plain data"',
    'func f() { os.ReadFile(filepath.Join("testdata", "case.json")) }',
  ].join("\n");
  assert.deepEqual(literalsOf("internal/x/x.go", source), [
    { text: "page.html", kind: "embed" },
    { text: "dist", kind: "embed" },
    { text: "testdata", kind: "read" },
    { text: "case.json", kind: "read" },
    // The inner Join's arguments, again, and the path it builds.
    { text: "testdata", kind: "read" },
    { text: "case.json", kind: "read" },
    { text: "testdata/case.json", kind: "read" },
  ]);
});

const tracked = new Set([
  "scripts/a.mjs",
  "docs/design/x.md",
  "docs/design/schemas/one.json",
  "pkg/README.md",
  "pkg/src/index.ts",
  "pkg/src/index.test.ts",
  "internal/x/page.html",
]);
const folders = new Set([
  "scripts",
  "docs",
  "docs/design",
  "docs/design/schemas",
  "pkg",
  "pkg/src",
  "internal",
  "internal/x",
]);
const at = (file, packageDir = "pkg") => ({ file, packageDir, tracked, folders });

test("namedPaths resolves from the file, the package (tests only) and the repository root", () => {
  assert.deepEqual(
    namedPaths({ text: "../../scripts/a.mjs", kind: "import" }, at("pkg/src/index.ts")),
    [{ path: "scripts/a.mjs", folder: false }],
  );
  // Extensionless imports probe the source extensions.
  assert.deepEqual(namedPaths({ text: "./index", kind: "import" }, at("pkg/src/index.test.ts")), [
    { path: "pkg/src/index.ts", folder: false },
  ]);
  // A test reads with its package as working directory.
  assert.deepEqual(namedPaths({ text: "README.md", kind: "read" }, at("pkg/src/index.test.ts")), [
    { path: "pkg/README.md", folder: false },
  ]);
  assert.deepEqual(namedPaths({ text: "README.md", kind: "read" }, at("pkg/src/index.ts")), []);
  assert.deepEqual(
    namedPaths({ text: "docs/design/schemas", kind: "read" }, at("pkg/src/index.ts")),
    [{ path: "docs/design/schemas", folder: true }],
  );
  assert.deepEqual(namedPaths({ text: "page.html", kind: "embed" }, at("internal/x/x.go", "")), [
    { path: "internal/x/page.html", folder: false },
  ]);
  for (const text of ["https://example.com/a.md", "/etc/hosts", "src/**/*.ts", ".", "utf8"]) {
    assert.deepEqual(namedPaths({ text, kind: "read" }, at("pkg/src/index.test.ts")), [], text);
  }
});

// A trimmed `turbo run … --dry=json`: inputs relative to the package.
function dry(...tasks) {
  return {
    tasks: tasks.map(([taskId, directory, inputs, dependencies = [], extra = {}]) => ({
      taskId,
      task: taskId.split("#")[1],
      package: taskId.split("#")[0],
      directory,
      command: "pnpm run x",
      inputs: Object.fromEntries(inputs.map((file) => [file, "hash"])),
      outputs: [],
      dependencies,
      ...extra,
    })),
  };
}

const sources = {
  "pkg/src/index.test.ts": 'import "./index"; readFileSync(join(root, "docs/design/x.md"));',
  "pkg/src/index.ts": 'import "../../scripts/a.mjs";',
  "scripts/a.mjs": "export const a = 1;",
};
const read = (file) => sources[file] ?? null;

test("referenceProblems names a read that neither the task nor its dependencies hash", () => {
  const tasks = taskGraph(
    dry(
      ["@z/pkg#test", "pkg", ["src/index.test.ts", "src/index.ts"]],
      ["@z/pkg#build", "pkg", ["src/index.ts", "../scripts/a.mjs"]],
    ),
  );
  assert.deepEqual(referenceProblems(tasks, { tracked, read, exceptions: new Map() }), [
    '@z/pkg#test: pkg/src/index.test.ts reads docs/design/x.md ("docs/design/x.md"), which is not part of its result',
    '@z/pkg#test: pkg/src/index.ts reads scripts/a.mjs ("../../scripts/a.mjs"), which is not part of its result',
  ]);
});

test("referenceProblems accepts a dependency's inputs, a global input, a dependency's output and an exception", () => {
  const tasks = taskGraph(
    dry(
      [
        "@z/pkg#test",
        "pkg",
        ["src/index.test.ts", "src/index.ts"],
        ["@z/pkg#build", "@z/docs#build"],
      ],
      ["@z/pkg#build", "pkg", ["src/index.ts", "../scripts/a.mjs"]],
      ["@z/docs#build", "docs", [], [], { outputs: ["design/**"] }],
    ),
  );
  assert.deepEqual(referenceProblems(tasks, { tracked, read, exceptions: new Map() }), []);
  const alone = taskGraph(dry(["@z/pkg#test", "pkg", ["src/index.test.ts", "src/index.ts"]]));
  const globalFiles = new Set(["scripts/a.mjs"]);
  const exceptions = new Map([["@z/pkg#*|docs/design/x.md", "read as data"]]);
  assert.deepEqual(referenceProblems(alone, { tracked, read, globalFiles, exceptions }), []);
});

test("referenceProblems follows what each kind of task runs", () => {
  // A build does not run the tests, and a typecheck only resolves imports.
  for (const name of ["build", "typecheck"]) {
    const tasks = taskGraph(
      dry([`@z/pkg#${name}`, "pkg", ["src/index.test.ts", "src/index.ts", "../scripts/a.mjs"]]),
    );
    assert.deepEqual(referenceProblems(tasks, { tracked, read, exceptions: new Map() }), [], name);
  }
  const lint = taskGraph(dry(["@z/pkg#lint", "pkg", ["src/index.test.ts", "src/index.ts"]]));
  assert.deepEqual(referenceProblems(lint, { tracked, read, exceptions: new Map() }), []);
});

test("referenceProblems checks the files a task's command names", () => {
  const tasks = taskGraph(
    dry(["@z/pkg#test", "pkg", [], [], { command: "node ../scripts/a.mjs -- vitest run" }]),
  );
  assert.deepEqual(referenceProblems(tasks, { tracked, read, exceptions: new Map() }), [
    '@z/pkg#test: its command reads scripts/a.mjs ("../scripts/a.mjs"), which is not part of its result',
  ]);
});

test("edgeProblems wants a build of each declared workspace package before the tasks that use it", () => {
  const tasks = taskGraph(
    dry(
      ["@z/app#build", "app", [], ["@z/lib#build"]],
      ["@z/app#typecheck", "app", [], ["@z/lib#build"]],
      ["@z/app#test", "app", []],
      ["@z/lib#build", "lib", []],
      ["@z/kit#build", "kit", []],
    ),
  );
  const manifests = new Map([
    [
      "@z/app",
      {
        dependencies: { "@z/lib": "workspace:*" },
        devDependencies: { "@z/kit": "workspace:*", vitest: "^4" },
      },
    ],
  ]);
  assert.deepEqual(edgeProblems(tasks, manifests, new Map()), [
    "@z/app#typecheck: declares @z/kit but does not depend on @z/kit#build",
    "@z/app#test: declares @z/lib but does not depend on @z/lib#build",
    "@z/app#test: declares @z/kit but does not depend on @z/kit#build",
  ]);
  const exceptions = new Map([
    ["@z/app#typecheck|@z/kit", "why"],
    ["@z/app#test|@z/lib", "why"],
    ["@z/app#test|@z/kit", "why"],
  ]);
  assert.deepEqual(edgeProblems(tasks, manifests, exceptions), []);
});

test("ignoredProblems names a task hashing ignored files, unless allowed", () => {
  const tasks = taskGraph(dry(["//#lint", "", ["scripts/a.mjs", "node_modules/x/index.js"]]));
  const ignored = new Set(["node_modules/x/index.js"]);
  assert.deepEqual(ignoredProblems(tasks, ignored, []), [
    "//#lint: hashes 1 ignored file(s), e.g. node_modules/x/index.js",
  ]);
  assert.deepEqual(ignoredProblems(tasks, ignored, [/^\/\/#lint\|node_modules\//]), []);
});
