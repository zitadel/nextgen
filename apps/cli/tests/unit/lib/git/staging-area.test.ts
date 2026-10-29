import { afterEach, describe, expect, it } from "vitest";

import { SomethingIsStaged } from "../../../../src/lib/git/checks/something-is-staged";
import { STAGED_FILES } from "../../../../src/lib/git/checks/staged-files";
import { Git } from "../../../../src/lib/git/git";
import { StagingArea } from "../../../../src/lib/git/staging-area";
import { GitScratch, git, headChanges, stagedFiles, write } from "../../../helpers/git-repo";

const scratch = new GitScratch();

afterEach(() => scratch.cleanup());

/** What `staging` holds staged against the last commit. */
async function staged(staging: StagingArea): Promise<string[]> {
  return (await staging.git.run(STAGED_FILES)).paths();
}

describe("StagingArea", () => {
  it("matches the last commit once started from it", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      return staged(staging);
    });

    expect(files).toEqual([]);
  });

  it("stages without touching the developer's own staging area", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n" });

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      await staging.addAll();
      return staged(staging);
    });

    expect({ temporary: files, developers: await stagedFiles(cwd) }).toEqual({
      temporary: ["b.txt"],
      developers: [],
    });
  });

  it("takes out what `except` matches", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n", ".env": "S=1\n" });

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      await staging.addAll();
      await staging.unstage((path) => path === ".env");
      return staged(staging);
    });

    expect(files).toEqual(["b.txt"]);
  });

  it("starts from what the developer has staged", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n" });
    await git(cwd, "add", "b.txt");

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromDevelopers(new Git(cwd));
      return staged(staging);
    });

    expect(files).toEqual(["b.txt"]);
  });

  it("marks only the paths that exist as added", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n" });

    const files = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      await staging.markAsAdded(["b.txt", "gone.txt"]);
      return (await staging.git.run(["ls-files", "-z"])).paths();
    });

    expect(files).toEqual(["a.txt", "b.txt"]);
  });

  it("gives the first problem its checks find", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });

    const problem = await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      return staging.problem([new SomethingIsStaged()]);
    });

    expect(problem).toBe("there was nothing to commit");
  });

  it("commits what is staged", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n" });
    await write(cwd, { "b.txt": "b\n" });

    await StagingArea.temporary(new Git(cwd), async (staging) => {
      await staging.startFromHead();
      await staging.addAll();
      await staging.commit("add b", {});
    });

    expect(await headChanges(cwd)).toEqual(["b.txt"]);
  });
});
