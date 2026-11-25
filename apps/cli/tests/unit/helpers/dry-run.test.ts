import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";
import { holdingADryRunToNothing } from "@tests/helpers/dry-run";
import { usePlatformMock } from "@tests/helpers/platform";
import { rejectionOf } from "@tests/helpers/thrown-value";

usePlatformMock();

/** The platform's address, which the mock answers whatever the path. */
const SERVER = "http://dry-run.test";

describe("holdingADryRunToNothing", () => {
  it("lets a dry run that changed nothing through", async ({ dir }) => {
    await writeFile(join(dir, "kept.txt"), "same");

    const result = await holdingADryRunToNothing("deploy --dry-run", dir, async () => {
      return "ok";
    });

    expect(result).toBe("ok");
  });

  it("names a file the dry run created", async ({ dir }) => {
    const error = await rejectionOf(() => {
      return holdingADryRunToNothing("setup --dry-run", dir, async () => {
        await writeFile(join(dir, "new.txt"), "x");
      });
    });

    expect(error).toMatchObject({
      message: "a dry run of `setup --dry-run` changed things: created new.txt",
    });
  });

  it("names a file the dry run changed", async ({ dir }) => {
    await writeFile(join(dir, "kept.txt"), "before");

    const error = await rejectionOf(() => {
      return holdingADryRunToNothing("setup --dry-run", dir, async () => {
        await writeFile(join(dir, "kept.txt"), "after");
      });
    });

    expect(error).toMatchObject({ message: expect.stringContaining("changed kept.txt") });
  });

  it("names a file the dry run removed", async ({ dir }) => {
    await writeFile(join(dir, "kept.txt"), "before");

    const error = await rejectionOf(() => {
      return holdingADryRunToNothing("eject --dry-run", dir, async () => {
        await rm(join(dir, "kept.txt"));
      });
    });

    expect(error).toMatchObject({ message: expect.stringContaining("removed kept.txt") });
  });

  it("ignores what git and the package manager keep", async ({ dir }) => {
    await mkdir(join(dir, ".git"));

    await holdingADryRunToNothing("deploy --dry-run", dir, async () => {
      await writeFile(join(dir, ".git", "index"), "touched");
    });
  });

  it("names a request that writes to the platform", async ({ dir }) => {
    const error = await rejectionOf(() => {
      return holdingADryRunToNothing("origin add --dry-run", dir, async () => {
        await fetch(`${SERVER}/projects/proj_1/origins`, { method: "POST", body: "{}" });
      });
    });

    expect(error).toMatchObject({
      message: expect.stringContaining("asked the platform to POST /projects/proj_1/origins"),
    });
  });

  it("allows a request that only reads, though it is a POST", async ({ dir }) => {
    await holdingADryRunToNothing("deploy --dry-run", dir, async () => {
      await fetch(`${SERVER}/users/query`, { method: "POST", body: "{}" });
    });
  });
});
