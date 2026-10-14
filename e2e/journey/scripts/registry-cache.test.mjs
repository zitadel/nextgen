import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, test } from "vitest";

import {
  DEFAULT_MAXAGE_MS,
  listTarballs,
  newTarballs,
  packumentsWrittenSince,
  readTarballList,
  uplinkMaxageMs,
} from "./registry-cache.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "registry-cache.mjs");

// The npmjs uplink as local-registry.mjs writes it, with and without a maxage.
const configWith = (maxage) => `storage: /tmp/storage
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
${maxage ? `    maxage: ${maxage}\n` : ""}packages:
  '**':
    proxy: npmjs
`;

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

// Backdates a file, so whatever is written afterwards is unambiguously newer.
async function age(path, seconds = 60) {
  const when = new Date(Date.now() - seconds * 1000);
  await utimes(path, when, when);
}

function run(...args) {
  const output = join(root, "github-output");
  const result = spawnSync("node", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: output },
  });
  return { ...result, output };
}

// `list`, backdated as if the restore had been a minute before the journey.
async function listRestored() {
  const list = join(root, "restored.txt");
  assert.equal(run("list", storage, list).status, 0);
  await age(list);
  return list;
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
  assert.deepEqual(await readTarballList(join(root, "missing.txt")), {
    tarballs: [],
    listedAt: 0,
  });
});

test("packuments written since a time are the refreshed and the new ones", async () => {
  await put("react/package.json", "{}");
  await put("vite/package.json", "{}");
  await put("@types/node/package.json", "{}");
  for (const path of ["react", "vite", "@types/node"]) {
    await age(join(storage, path, "package.json"), 120);
  }
  const since = Date.now() - 60_000;
  await put("vite/package.json", '{"_uplinks":{"npmjs":{"fetched":2}}}');
  await put("svelte/package.json", "{}");
  // Neither is a packument that would make a later run faster.
  await put("@zitadel/cli/package.json", "{}");
  await put(".verdaccio-db.json", "{}");

  assert.deepEqual(await packumentsWrittenSince(storage, since), [
    "svelte/package.json",
    "vite/package.json",
  ]);
});

test("reads the npmjs uplink's maxage the way Verdaccio does", () => {
  assert.equal(uplinkMaxageMs(configWith("1h")), 3_600_000);
  assert.equal(uplinkMaxageMs(configWith("30m")), 1_800_000);
  assert.equal(uplinkMaxageMs(configWith('"90s"')), 90_000);
  assert.equal(uplinkMaxageMs(configWith("90")), 90_000);
  assert.equal(uplinkMaxageMs(configWith("1h 30m")), 5_400_000);
  // Verdaccio's default: no maxage, no config, or one this parser cannot read.
  assert.equal(uplinkMaxageMs(configWith("")), DEFAULT_MAXAGE_MS);
  assert.equal(uplinkMaxageMs(""), DEFAULT_MAXAGE_MS);
  assert.equal(uplinkMaxageMs(configWith("soon")), DEFAULT_MAXAGE_MS);
});

test("rewritten metadata and republished @zitadel packages do not save under the default maxage", async () => {
  await put("react/package.json", '{"_uplinks":{"npmjs":{"fetched":1}}}');
  await put("react/react-19.0.0.tgz");
  await put("@zitadel/cli/cli-1.0.0-alpha.24.tgz");
  await age(join(storage, "react/package.json"), 120);
  const list = await listRestored();

  // What a journey that fetched nothing leaves behind under the 2-minute
  // default: every packument it used revalidated.
  await put("react/package.json", '{"_uplinks":{"npmjs":{"fetched":2}}}');
  await rm(join(storage, "@zitadel"), { recursive: true });
  await put("@zitadel/cli/cli-1.0.0-alpha.25.tgz");
  const config = join(root, "config.yaml");
  await writeFile(config, configWith(""));

  const compared = run("compare", storage, list, config);
  assert.equal(compared.status, 0, compared.stderr);
  assert.match(compared.stdout, /1 tarballs restored, 1 now, 0 new/);
  assert.match(
    compared.stdout,
    /1 packuments refreshed; with an uplink maxage of 120 s they do not count/,
  );
  assert.equal(await readFile(compared.output, "utf8"), "save=false\n");
});

test("refreshed packuments save when the maxage outlasts the gap between runs", async () => {
  await put("react/package.json", '{"_uplinks":{"npmjs":{"fetched":1}}}');
  await put("react/react-19.0.0.tgz");
  await age(join(storage, "react/package.json"), 120);
  const list = await listRestored();
  const config = join(root, "config.yaml");
  await writeFile(config, configWith("1h"));

  // Within the hour Verdaccio rewrites nothing.
  const unchanged = run("compare", storage, list, config);
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.match(unchanged.stdout, /0 packuments refreshed/);
  assert.equal(await readFile(unchanged.output, "utf8"), "save=false\n");

  // Past the hour it revalidates and rewrites what the journey asked for.
  await put("react/package.json", '{"_uplinks":{"npmjs":{"fetched":2}}}');
  await rm(unchanged.output);
  const refreshed = run("compare", storage, list, config);
  assert.equal(refreshed.status, 0, refreshed.stderr);
  assert.match(
    refreshed.stdout,
    /1 packuments refreshed; with an uplink maxage of 3600 s they count/,
  );
  assert.equal(await readFile(refreshed.output, "utf8"), "save=true\n");
});

test("a fetched tarball is new", async () => {
  await put("react/react-19.0.0.tgz");
  const list = await listRestored();
  assert.equal(await readFile(list, "utf8"), "react/react-19.0.0.tgz\n");

  await put("react/react-19.0.1.tgz");
  const compared = run("compare", storage, list);
  assert.equal(compared.status, 0, compared.stderr);
  assert.match(compared.stdout, /1 new\n {2}react\/react-19\.0\.1\.tgz\n/);
  assert.equal(await readFile(compared.output, "utf8"), "save=true\n");
});

test("a cold restore saves whatever the journey fetched", async () => {
  const list = await listRestored();
  assert.equal(await readFile(list, "utf8"), "");

  await put("react/react-19.0.0.tgz");
  const compared = run("compare", storage, list);
  assert.equal(compared.status, 0, compared.stderr);
  assert.equal(await readFile(compared.output, "utf8"), "save=true\n");
});

test("refuses an unknown command", () => {
  const result = run("save", storage, join(root, "restored.txt"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage: node registry-cache\.mjs <list\|compare>/);
});
