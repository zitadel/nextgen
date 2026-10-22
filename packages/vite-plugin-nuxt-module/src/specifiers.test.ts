import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyEdits,
  rewriteDeclarationImports,
  rewriteImports,
  rewriteSpecifier,
  runtimeOutName,
  sourceFileOf,
  specifierEdits,
} from "./specifiers.ts";

const dirs: string[] = [];
function tree(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nuxt-plugin-test-")));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const layout = {
  "src/module.ts": "",
  "src/utils/headers.ts": "",
  "src/other.ts": "",
  "src/runtime/plugins/a.ts": "",
  "src/runtime/shared/b.ts": "",
  "src/runtime/components/C.vue": "",
};

describe("runtimeOutName", () => {
  it.each([
    ["plugin.ts", "plugin.js"],
    ["c.tsx", "c.js"],
    ["m.mts", "m.mjs"],
    ["types.d.ts", "types.d.ts"],
    ["C.vue", "C.vue"],
    ["assets/main.scss", "assets/main.css"],
    ["assets/legacy.sass", "assets/legacy.css"],
  ])("writes %s as %s", (file, expected) => {
    expect(runtimeOutName(file)).toBe(expected);
  });
});

describe("rewriteSpecifier", () => {
  it("adds the per-file extension to a runtime-internal import", () => {
    const root = tree(layout);
    const scope = { runtimeDir: join(root, "src/runtime"), entries: {} };
    expect(rewriteSpecifier("../shared/b", join(root, "src/runtime/plugins/a.ts"), scope)).toBe(
      "../shared/b.js",
    );
  });

  it("points a runtime import of a bundled entry at the entry's output", () => {
    const root = tree(layout);
    const scope = {
      runtimeDir: join(root, "src/runtime"),
      entries: { [join(root, "src/utils/headers.ts")]: "utils/headers.mjs" },
    };
    expect(
      rewriteSpecifier("../../utils/headers", join(root, "src/runtime/plugins/a.ts"), scope),
    ).toBe("../../utils/headers.mjs");
  });

  it("points a runtime import of the module at the module output", () => {
    const root = tree(layout);
    const scope = {
      runtimeDir: join(root, "src/runtime"),
      entries: { [join(root, "src/module.ts")]: "module.js" },
    };
    expect(rewriteSpecifier("../../module", join(root, "src/runtime/plugins/a.ts"), scope)).toBe(
      "../../module.js",
    );
  });

  it("leaves an import outside the runtime that is not an entry untouched", () => {
    const root = tree(layout);
    const scope = { runtimeDir: join(root, "src/runtime"), entries: {} };
    expect(rewriteSpecifier("../../other", join(root, "src/runtime/plugins/a.ts"), scope)).toBe(
      "../../other",
    );
  });

  it("keeps a .vue import and its query", () => {
    const root = tree(layout);
    expect(
      rewriteSpecifier("../components/C.vue?raw", join(root, "src/runtime/plugins/a.ts")),
    ).toBe("../components/C.vue?raw");
  });

  it("points an import of a runtime stylesheet at the CSS it compiles to", () => {
    const root = tree({ ...layout, "src/runtime/assets/main.scss": "" });
    const scope = { runtimeDir: join(root, "src/runtime"), entries: {} };
    expect(
      rewriteSpecifier("../assets/main.scss", join(root, "src/runtime/plugins/a.ts"), scope),
    ).toBe("../assets/main.css");
  });

  it("leaves an import of a Sass partial untouched", () => {
    const root = tree({ ...layout, "src/runtime/assets/_vars.scss": "" });
    const scope = { runtimeDir: join(root, "src/runtime"), entries: {} };
    expect(
      rewriteSpecifier("../assets/_vars.scss", join(root, "src/runtime/plugins/a.ts"), scope),
    ).toBe("../assets/_vars.scss");
  });

  it("leaves a package import untouched", () => {
    expect(rewriteSpecifier("vue", "/x/a.ts")).toBe("vue");
  });

  it("rewrites entry imports inside declarations too", () => {
    const root = tree(layout);
    const scope = {
      runtimeDir: join(root, "src/runtime"),
      entries: { [join(root, "src/utils/headers.ts")]: "utils/headers.mjs" },
    };
    expect(
      rewriteDeclarationImports(
        `import { x } from "../../utils/headers";`,
        join(root, "src/runtime/plugins/a.d.ts"),
        scope,
      ),
    ).toBe(`import { x } from "../../utils/headers.mjs";`);
  });
});

describe("rewriteImports", () => {
  it("rewrites static, dynamic and re-export specifiers of a module", () => {
    const root = tree(layout);
    const code =
      'import "../shared/b";\nexport * from "../shared/b";\nconst m = () => import("../shared/b");\n';
    expect(rewriteImports(code, join(root, "src/runtime/plugins/a.ts"))).toBe(
      'import "../shared/b.js";\nexport * from "../shared/b.js";\nconst m = () => import("../shared/b.js");\n',
    );
  });
});

describe("sourceFileOf", () => {
  it.each([
    ["src/runtime/shared/b", "src/runtime/shared/b.ts"],
    ["src/runtime/shared/b.js", "src/runtime/shared/b.ts"],
    ["src/runtime/components/C.vue", "src/runtime/components/C.vue"],
    ["src/runtime/missing", undefined],
  ])("finds the source of %s", (target, expected) => {
    const root = tree(layout);
    expect(sourceFileOf(join(root, target))).toBe(expected && join(root, expected));
  });
});

describe("specifierEdits", () => {
  const to = (spec: string) => (spec.startsWith("./") ? `.${spec}` : undefined);

  it("finds the specifiers of imports, re-exports, dynamic imports and import types of a module", () => {
    const code =
      'import a from "./a";\nexport * from "./b";\nexport { c } from "./c";\nconst d = () => import("./d");\nimport e from "pkg";\n';
    expect(applyEdits(code, specifierEdits(code, "js", to))).toBe(
      'import a from "../a";\nexport * from "../b";\nexport { c } from "../c";\nconst d = () => import("../d");\nimport e from "pkg";\n',
    );
  });

  it("finds the specifiers of a declaration, import types included, and keeps their quotes", () => {
    const code = "import type { A } from './a';\nexport declare const b: import(\"./b\").B;\n";
    expect(applyEdits(code, specifierEdits(code, "dts", to))).toBe(
      "import type { A } from '../a';\nexport declare const b: import(\"../b\").B;\n",
    );
  });

  it("leaves strings that merely look like imports alone", () => {
    const code =
      'const text = \'from "./a"\';\n// import "./b"\nexport const c = import_("./c");\n';
    expect(applyEdits(code, specifierEdits(code, "js", to))).toBe(code);
  });

  it("writes a specifier with a quote in it as a JSON string", () => {
    const code = "import a from './a';\n";
    expect(
      applyEdits(
        code,
        specifierEdits(code, "js", () => "./it's"),
      ),
    ).toBe('import a from "./it\'s";\n');
  });
});
