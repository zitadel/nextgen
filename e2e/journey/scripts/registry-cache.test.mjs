import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, test } from "vitest";

import * as localRegistry from "./local-registry.mjs";
import {
  DEFAULT_MAXAGE_MS,
  compareStore,
  listTarballs,
  maxageMs,
  newTarballs,
  packumentsWrittenSince,
  parseInterval,
  readTarballList,
} from "./registry-cache.mjs";

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

// A restored store with one package whose packument predates the restore.
async function restoredReact() {
  await put("react/package.json", '{"_uplinks":{"npmjs":{"fetched":1}}}');
  await put("react/react-19.0.0.tgz");
  await age(join(storage, "react/package.json"), 120);
  return listRestored();
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

test("reads maxage intervals the way Verdaccio does", () => {
  assert.equal(parseInterval("1h"), 3_600_000);
  assert.equal(parseInterval("30m"), 1_800_000);
  assert.equal(parseInterval("90s"), 90_000);
  assert.equal(parseInterval("90"), 90_000);
  assert.equal(parseInterval(90), 90_000);
  assert.equal(parseInterval("1h 30m"), 5_400_000);
  assert.equal(parseInterval("soon"), undefined);
  // Without a readable one, Verdaccio's default applies.
  assert.equal(maxageMs(undefined), DEFAULT_MAXAGE_MS);
  assert.equal(maxageMs(""), DEFAULT_MAXAGE_MS);
  assert.equal(maxageMs("soon"), DEFAULT_MAXAGE_MS);
});

test.skipIf(localRegistry.UPLINK_MAXAGE === undefined)(
  "local-registry.mjs's UPLINK_MAXAGE is an interval this reads",
  () => {
    assert.notEqual(parseInterval(localRegistry.UPLINK_MAXAGE), undefined);
  },
);

test("refreshed packuments do not count under the default maxage", async () => {
  const listFile = await restoredReact();
  // Under the 2-minute default every packument a journey uses revalidates.
  await put("react/package.json", '{"_uplinks":{"npmjs":{"fetched":2}}}');

  const result = await compareStore({ storage, listFile, maxage: undefined });
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.refreshed, ["react/package.json"]);
  assert.equal(result.maxageInMs, DEFAULT_MAXAGE_MS);
  assert.equal(result.save, false);
});

test("refreshed packuments save when the maxage outlasts the gap between runs", async () => {
  const listFile = await restoredReact();

  // Within the hour Verdaccio rewrites nothing.
  const unchanged = await compareStore({ storage, listFile, maxage: "1h" });
  assert.deepEqual(unchanged.refreshed, []);
  assert.equal(unchanged.save, false);

  // Past the hour it revalidates and rewrites what the journey asked for.
  await put("react/package.json", '{"_uplinks":{"npmjs":{"fetched":2}}}');
  const refreshed = await compareStore({ storage, listFile, maxage: "1h" });
  assert.deepEqual(refreshed.refreshed, ["react/package.json"]);
  assert.equal(refreshed.refreshesLast, true);
  assert.equal(refreshed.save, true);
});

test("a journey that changed nothing a later run uses does not save", async () => {
  await put("@zitadel/cli/cli-1.0.0-alpha.24.tgz");
  const list = await restoredReact();
  // What every run does: republish @zitadel, which Verdaccio records.
  await rm(join(storage, "@zitadel"), { recursive: true });
  await put("@zitadel/cli/package.json", "{}");
  await put("@zitadel/cli/cli-1.0.0-alpha.25.tgz");
  await put(".verdaccio-db.json", '{"list":["@zitadel/cli"]}');

  const compared = run("compare", storage, list);
  assert.equal(compared.status, 0, compared.stderr);
  assert.match(compared.stdout, /1 tarballs restored, 1 now, 0 new/);
  assert.match(compared.stdout, /0 packuments refreshed/);
  assert.equal(await readFile(compared.output, "utf8"), "save=false\n");
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
