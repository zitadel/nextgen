import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "vitest";

import { runCapture } from "./dev-process.mjs";

const script = fileURLToPath(new URL("../apps/cloud/setup-secrets.sh", import.meta.url));
const tempDirs = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(envs = [], { failKey = "", installed = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "cloud-setup-test-"));
  tempDirs.push(dir);
  const bin = join(dir, "bin");
  const out = join(dir, "secrets");
  const calls = join(dir, "calls.jsonl");
  const setupScript = installed ? script : join(dir, "setup-secrets.sh");
  if (!installed) await copyFile(script, setupScript);
  await mkdir(bin);
  await writeFile(calls, "");
  // All Vercel commands are captured locally; these tests cannot contact Vercel.
  await writeFile(
    join(bin, "npx"),
    `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const verb = args[3];
const value = verb === "add" ? readFileSync(0, "utf8") : "";
appendFileSync(process.env.TEST_CALLS, JSON.stringify({ args, value }) + "\\n");
if (args[2] !== "env") process.exit(98);
if (verb === "ls") process.stdout.write(process.env.TEST_ENVS);
else if (verb === "add" && args[4] === process.env.TEST_FAIL_KEY) process.exit(1);
else if (verb !== "add" && verb !== "rm") process.exit(99);
`,
    { mode: 0o755 },
  );
  // Key generation itself is covered by the crypto tests; keep orchestration fast.
  await writeFile(
    join(bin, "openssl"),
    `#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(process.argv[process.argv.indexOf("-out") + 1], "test-master-key");
`,
    { mode: 0o755 },
  );
  return {
    out,
    run: (...args) =>
      runCapture("sh", [setupScript, "--out", out, ...args], {
        env: {
          ...process.env,
          PATH: [bin, process.env.PATH].join(delimiter),
          OP_VAULT: "",
          VERCEL_PROJECT_ID: "prj_test",
          VERCEL_TEAM_SLUG: "test-team",
          TEST_CALLS: calls,
          TEST_ENVS: JSON.stringify({ envs }),
          TEST_FAIL_KEY: failKey,
        },
      }),
    calls: async () =>
      (await readFile(calls, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse),
  };
}

describe.skipIf(spawnSync("jq", ["--version"]).status !== 0)("cloud setup (requires jq)", () => {
  test("cloud setup upserts scoped values over stdin and uses the shared bootstrap document", async () => {
    const fixture = await setup();
    const { stdout, stderr } = await fixture.run("--email", "cloud@example.test", "preview");
    const updates = (await fixture.calls()).filter(({ args }) => args[3] === "add");
    assert.equal(updates.length, 3);
    for (const { args, value } of updates) {
      assert.equal(args[5], "preview");
      assert.ok(args.includes("--force"));
      assert.equal(args[args.indexOf("--project") + 1], "prj_test");
      assert.equal(args[args.indexOf("--scope") + 1], "test-team");
      assert.equal(
        args[args.indexOf("--type") + 1],
        args[4] === "MASTER_KEY_ID" ? "config" : "secret",
      );
      assert.ok(!args.includes(value));
      if (args[4] === "MASTER_KEY_ID") assert.match(value, /^[A-Za-z0-9._-]+$/);
    }
    assert.ok(!(await fixture.calls()).some(({ args }) => args[3] === "rm"));
    const dir = join(fixture.out, "preview");
    assert.equal(
      updates.find(({ args }) => args[4] === "MASTER_KEY_ID").value,
      (await readFile(join(dir, "master-key.id"), "utf8")).trimEnd(),
    );
    const admin = JSON.parse(await readFile(join(dir, "admin.json"), "utf8"));
    const document = JSON.parse(await readFile(join(dir, "admin-user.json"), "utf8"));
    assert.equal(document.header.id, admin.user_id);
    assert.equal(document.header.project_id, "proj_platform");
    assert.equal(document.attributes.email, "cloud@example.test");
    assert.ok(!JSON.stringify(document).includes(admin.password));
    assert.ok(!(stdout + stderr).includes(admin.password));
    assert.equal((await stat(join(dir, "admin.json"))).mode & 0o777, 0o600);
  });

  test("a failed replacement stops without removing existing configuration", async () => {
    const fixture = await setup([{ key: "MASTER_KEY_PREVIOUS_ID", target: ["preview"] }], {
      failKey: "MASTER_KEY_ID",
    });
    await assert.rejects(fixture.run("preview"));
    const calls = await fixture.calls();
    assert.deepEqual(
      calls.filter(({ args }) => args[3] === "add").map(({ args }) => args[4]),
      ["MASTER_KEY_PEM_B64", "MASTER_KEY_ID"],
    );
    assert.ok(!calls.some(({ args }) => args[3] === "rm"));
  });

  test("shared variables are rejected before minting or writing anything", async () => {
    const fixture = await setup([{ key: "MASTER_KEY_ID", target: ["production", "preview"] }]);
    await assert.rejects(fixture.run("preview"), (error) => error.code === 65);
    assert.equal((await fixture.calls()).length, 1);
    await assert.rejects(stat(fixture.out), { code: "ENOENT" });
  });

  test("missing workspace dependencies are rejected before minting or contacting Vercel", async () => {
    const fixture = await setup([], { installed: false });
    await assert.rejects(fixture.run("preview"), (error) => {
      assert.equal(error.code, 69);
      assert.match(error.stderr, /pnpm install --frozen-lockfile/);
      return true;
    });
    assert.equal((await fixture.calls()).length, 0);
    await assert.rejects(stat(fixture.out), { code: "ENOENT" });
  });

  test.each([
    "MASTER_KEY_ID",
    "MASTER_KEY_PEM_B64",
    "MASTER_KEY_PREVIOUS_ID",
    "MASTER_KEY_PREVIOUS_PEM_B64",
  ])("rejects a %s branch override before minting or writing anything", async (key) => {
    const fixture = await setup([
      { key: "MASTER_KEY_PREVIOUS_ID", target: ["preview"] },
      { key, target: ["preview"], gitBranch: "feature" },
    ]);
    await assert.rejects(fixture.run("preview"), (error) => error.code === 65);
    assert.equal((await fixture.calls()).length, 1);
    await assert.rejects(stat(fixture.out), { code: "ENOENT" });
  });

  test("preview branch overrides do not block production setup", async () => {
    const fixture = await setup([
      { key: "MASTER_KEY_PREVIOUS_ID", target: ["preview"], gitBranch: "feature" },
    ]);
    await fixture.run("production");
    assert.ok(!(await fixture.calls()).some(({ args }) => args[3] === "rm"));
  });

  test("rotation preserves the old key before updating the current key", async () => {
    const fixture = await setup();
    await fixture.run("--skip-vercel", "preview");
    assert.equal((await fixture.calls()).length, 0);
    const oldID = await readFile(join(fixture.out, "preview/master-key.id"), "utf8");
    await fixture.run("--force", "preview");
    const updates = (await fixture.calls()).filter(({ args }) => args[3] === "add");
    assert.deepEqual(
      updates.map(({ args }) => args[4]),
      [
        "MASTER_KEY_PREVIOUS_PEM_B64",
        "MASTER_KEY_PREVIOUS_ID",
        "MASTER_KEY_PEM_B64",
        "MASTER_KEY_ID",
        "BOOTSTRAP_ADMIN_USER_JSON_B64",
      ],
    );
    assert.equal(updates[1].value, oldID.trimEnd());
    assert.notEqual(updates[3].value, oldID.trimEnd());
    assert.equal(
      updates[3].value,
      (await readFile(join(fixture.out, "preview/master-key.id"), "utf8")).trimEnd(),
    );
    assert.match(updates[1].value, /^[A-Za-z0-9._-]+$/);
    assert.match(updates[3].value, /^[A-Za-z0-9._-]+$/);
    assert.ok(!(await fixture.calls()).some(({ args }) => args[3] === "rm"));
  });

  test("both stale rotation variables are removed after every replacement succeeds", async () => {
    const fixture = await setup([
      { key: "MASTER_KEY_PREVIOUS_ID", target: ["preview"] },
      { key: "MASTER_KEY_PREVIOUS_PEM_B64", target: ["preview"] },
    ]);
    await fixture.run("preview");
    const calls = await fixture.calls();
    assert.deepEqual(
      calls.map(({ args }) => args[3]),
      ["ls", "add", "add", "add", "rm", "rm"],
    );
    assert.deepEqual(
      calls.slice(-2).map(({ args }) => args[4]),
      ["MASTER_KEY_PREVIOUS_PEM_B64", "MASTER_KEY_PREVIOUS_ID"],
    );
  });
});
