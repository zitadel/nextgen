import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";

import { publishBody } from "./publish-body.mjs";

const tarball = Buffer.from("not really gzip");

test("publishes the tarball under every tag with the digests npm computes", () => {
  const body = publishBody(
    { name: "@zitadel/cli", version: "1.2.3", description: "CLI", dependencies: { a: "^1" } },
    tarball,
    "http://127.0.0.1:4873",
    ["alpha", "latest"],
  );

  assert.deepEqual(body["dist-tags"], { alpha: "1.2.3", latest: "1.2.3" });
  assert.equal(body._id, "@zitadel/cli");
  const version = body.versions["1.2.3"];
  assert.equal(version._id, "@zitadel/cli@1.2.3");
  assert.deepEqual(version.dependencies, { a: "^1" });
  assert.deepEqual(version.dist, {
    integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
    shasum: createHash("sha1").update(tarball).digest("hex"),
    tarball: "http://127.0.0.1:4873/@zitadel/cli/-/@zitadel/cli-1.2.3.tgz",
  });
  assert.deepEqual(body._attachments["@zitadel/cli-1.2.3.tgz"], {
    content_type: "application/octet-stream",
    data: tarball.toString("base64"),
    length: tarball.length,
  });
});

test("normalizes bin as npm publish does", () => {
  const bin = (value) =>
    publishBody({ name: "@zitadel/server", version: "1.0.0", bin: value }, tarball, "http://r", [
      "latest",
    ]).versions["1.0.0"].bin;

  assert.deepEqual(bin({ nextgen: "./bin/nextgen" }), { nextgen: "bin/nextgen" });
  assert.deepEqual(bin({ "x/run": "bin\\run.js" }), { run: "bin/run.js" });
  assert.deepEqual(bin("./bin/server.js"), { server: "bin/server.js" });
  assert.equal(
    "bin" in
      publishBody({ name: "a", version: "1.0.0" }, tarball, "http://r", []).versions["1.0.0"],
    false,
  );
});
