import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, test } from "vitest";

import { listTarballs, newTarballs, readTarballList } from "./registry-cache.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "registry-cache.mjs");

let root;
let storage;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "registry-cache-test-"));
  storage = join(root, "storage");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// A store laid out the way Verdaccio's local storage writes one.
async function put(path, content = "x") {
  await mkdir(dirname(join(storage, path)), { recursive: true });
  await writeFile(join(storage, path), content);
}

function run(...args) {
  const output = join(root, "github-output");
  const result = spawnSync("node", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: output },
  });
  return { ...result, output };
}

test("lists the npmjs tarballs, sorted, without the republished @zitadel scope", async () => {
  await put(".verdaccio-db.json", "{}");
  await put("react/package.json", "{}");
  await put("react/react-19.0.0.tgz");
  await put("@types/node/package.json", "{}");
  await put("@types/node/node-24.0.0.tgz");
  await put("@zitadel/cli/package.json", "{}");
  await put("@zitadel/cli/cli-1.0.0-alpha.25.tgz");
  // A download Verdaccio has not finished and renamed yet.
  await put("vite/vite-7.0.0.tgz.tmp-123456");

  assert.deepEqual(await listTarballs(storage), [
    "@types/node/node-24.0.0.tgz",
    "react/react-19.0.0.tgz",
  ]);
});

test("a missing store has no tarballs", async () => {
  assert.deepEqual(await listTarballs(storage), []);
});

test("new tarballs are the ones the restored list lacks", () => {
  assert.deepEqual(newTarballs(["a/a-1.tgz", "b/b-1.tgz"], ["a/a-1.tgz", "b/b-1.tgz"]), []);
  assert.deepEqual(newTarballs(["a/a-1.tgz"], ["a/a-1.tgz", "a/a-2.tgz", "c/c-1.tgz"]), [
    "a/a-2.tgz",
    "c/c-1.tgz",
  ]);
});

test("without a restored list every tarball is new", async () => {
  assert.deepEqual(await readTarballList(join(root, "missing.txt")), []);
});

test("rewritten metadata and republished @zitadel packages report nothing new", async () => {
  await put("react/package.json", '{"_uplinks":{"npmjs":{"fetched":1}}}');
  await put("react/react-19.0.0.tgz");
  await put("@zitadel/cli/cli-1.0.0-alpha.24.tgz");
  const list = join(root, "restored.txt");
  assert.equal(run("list", storage, list).status, 0);

  // What a journey that fetched nothing leaves behind.
  await put("react/package.json", '{"_uplinks":{"npmjs":{"fetched":2}}}');
  await rm(join(storage, "@zitadel"), { recursive: true });
  await put("@zitadel/cli/cli-1.0.0-alpha.25.tgz");

  const compared = run("compare", storage, list);
  assert.equal(compared.status, 0, compared.stderr);
  assert.match(compared.stdout, /1 tarballs restored, 1 now, 0 new/);
  assert.equal(await readFile(compared.output, "utf8"), "count=0\n");
});

test("a fetched tarball is new", async () => {
  await put("react/react-19.0.0.tgz");
  const list = join(root, "restored.txt");
  assert.equal(run("list", storage, list).status, 0);
  assert.equal(await readFile(list, "utf8"), "react/react-19.0.0.tgz\n");

  await put("react/react-19.0.1.tgz");
  const compared = run("compare", storage, list);
  assert.equal(compared.status, 0, compared.stderr);
  assert.match(compared.stdout, /1 new\n {2}react\/react-19\.0\.1\.tgz\n/);
  assert.equal(await readFile(compared.output, "utf8"), "count=1\n");
});

test("a cold restore saves whatever the journey fetched", async () => {
  const list = join(root, "restored.txt");
  assert.equal(run("list", storage, list).status, 0);
  assert.equal(await readFile(list, "utf8"), "");

  await put("react/react-19.0.0.tgz");
  const compared = run("compare", storage, list);
  assert.equal(compared.status, 0, compared.stderr);
  assert.equal(await readFile(compared.output, "utf8"), "count=1\n");
});

test("refuses an unknown command", () => {
  const result = run("save", storage, join(root, "restored.txt"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage: node registry-cache\.mjs <list\|compare>/);
});
