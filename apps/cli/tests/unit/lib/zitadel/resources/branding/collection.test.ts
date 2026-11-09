import { describe, expect, it } from "vitest";

import { Branding, type Brandings, CONFIG_DIRECTORIES } from "@/lib/zitadel";
import { aBranding, aConfig, aFile, aLoginFlow } from "@tests/helpers/config";

/**
 * The descriptor's file name under `.zitadel/branding/`.
 */
const NAME = "branding.json";

/**
 * Where the descriptor in these tests sits.
 */
const PATH = `${CONFIG_DIRECTORIES.branding}/${NAME}`;

/**
 * Where a second descriptor, which the put tests add, sits.
 */
const OTHER_PATH = `${CONFIG_DIRECTORIES.branding}/other.json`;

/**
 * Where a flow sits, for the test that checks a collection leaves another
 * kind of file alone.
 */
const FLOW_PATH = `${CONFIG_DIRECTORIES.flows}/login.json`;

/**
 * The branding collection of a configuration holding one descriptor the
 * server accepts.
 *
 * @returns The collection.
 */
function brandings(): Brandings {
  return aConfig({ branding: { [NAME]: aBranding() } }).branding;
}

/**
 * The branding collection of a configuration holding one descriptor the
 * branding contract refuses, which is read as a broken file.
 *
 * @returns The collection.
 */
function brokenBrandings(): Brandings {
  return aConfig({ branding: { [NAME]: { layout: "sideways" } } }).branding;
}

describe("Brandings.kinds", () => {
  it("owns the branding kind", () => {
    const branding = brandings();

    expect(branding.kinds).toEqual(["branding"]);
  });

  it("does not own the flow kind", () => {
    const branding = brandings();

    expect(branding.kinds).not.toContain("flow");
  });
});

describe("Brandings.all", () => {
  it("holds the descriptor the configuration read", () => {
    const branding = brandings();

    expect(branding.all).toHaveLength(1);
  });

  it("is empty when the configuration has no descriptor", () => {
    const branding = aConfig().branding;

    expect(branding.all).toEqual([]);
  });
});

describe("Brandings.paths", () => {
  it("names the path of the descriptor", () => {
    const branding = brandings();

    expect(branding.paths).toEqual([PATH]);
  });

  it("is empty when the configuration has no descriptor", () => {
    const branding = aConfig().branding;

    expect(branding.paths).toEqual([]);
  });
});

describe("Brandings.get", () => {
  it("is the descriptor at its path", () => {
    const branding = brandings();

    expect(branding.get(PATH)).toBeInstanceOf(Branding);
  });

  it("is undefined for a path no descriptor sits at", () => {
    const branding = brandings();

    expect(branding.get(OTHER_PATH)).toBeUndefined();
  });
});

describe("Brandings.findByHandle", () => {
  it("is undefined for a handle, because a descriptor is not pinned by one", () => {
    const branding = brandings();

    expect(branding.findByHandle(NAME)).toBeUndefined();
  });

  it("is undefined when the configuration has no descriptor", () => {
    const branding = aConfig().branding;

    expect(branding.findByHandle(NAME)).toBeUndefined();
  });
});

describe("Brandings.filter", () => {
  it("keeps the descriptors that pass the test", () => {
    const branding = brandings();

    const kept = branding.filter(() => {
      return true;
    });

    expect(kept.paths).toEqual([PATH]);
  });

  it("keeps none when no descriptor passes the test", () => {
    const branding = brandings();

    const kept = branding.filter(() => {
      return false;
    });

    expect(kept.paths).toEqual([]);
  });
});

describe("Brandings.put", () => {
  it("adds a descriptor at a new path", () => {
    const branding = brandings();

    const change = branding.put(Branding.of(aFile("branding", "other.json", aBranding())));

    expect(change.after.branding.paths).toEqual([PATH, OTHER_PATH]);
  });

  it("replaces the descriptor at the same path rather than adding one", () => {
    const branding = brandings();

    const change = branding.put(Branding.create(aFile("branding", NAME, aBranding())));

    expect(change.after.branding.get(PATH)?.status).toBe("created");
    expect(change.after.branding.all).toHaveLength(1);
  });

  it("leaves the collection it was called on as it was", () => {
    const branding = brandings();

    branding.put(Branding.of(aFile("branding", "other.json", aBranding())));

    expect(branding.paths).toEqual([PATH]);
  });
});

describe("Brandings.remove", () => {
  it("removes the descriptor at the path", () => {
    const branding = brandings();

    const change = branding.remove(PATH);

    expect(change.removedPaths).toEqual([PATH]);
  });

  it("removes a broken descriptor of its own kind at the path", () => {
    const branding = brokenBrandings();

    const change = branding.remove(PATH);

    expect(change.removedPaths).toEqual([PATH]);
  });

  it("changes nothing for a path that holds no descriptor", () => {
    const branding = brandings();

    const change = branding.remove(OTHER_PATH);

    expect(change.changed).toBe(false);
  });

  it("leaves a broken file of another kind at the path alone", () => {
    const branding = aConfig({
      flows: { "login.json": { ...aLoginFlow(), steps: "none" } },
    }).branding;

    const change = branding.remove(FLOW_PATH);

    expect(change.changed).toBe(false);
  });
});
