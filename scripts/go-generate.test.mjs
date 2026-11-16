import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { expect } from "vitest";

import { test } from "./fixtures.ts";
import { findGeneratePackages } from "./go-generate.mjs";

test("generation discovers production directives only within its own Go module", ({
  dir: root,
}) => {
  const files = {
    "go.mod": "module example.com/root\n",
    "api/generate.go": "package api\n//go:generate echo api\n",
    "internal/mock/generate.go": "package mock\n//go:generate echo mock\n",
    "internal/model_test.go": "package internal\n//go:generate echo test\n",
    "internal/testdata/fixture.go": "package fixture\n//go:generate echo fixture\n",
    "tools/nested/go.mod": "module example.com/nested\n",
    "tools/nested/generate.go": "package nested\n//go:generate echo nested\n",
    ".vercel/cache/generate.go": "package cache\n//go:generate echo cache\n",
  };
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  expect([...findGeneratePackages(root)]).toEqual([
    ["api", ["//go:generate echo api"]],
    ["internal/mock", ["//go:generate echo mock"]],
  ]);
  expect([...findGeneratePackages(join(root, "tools/nested"))]).toEqual([
    ["", ["//go:generate echo nested"]],
  ]);
});
