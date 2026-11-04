import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../../helpers/clack")).clackDouble());

import { spinner } from "@clack/prompts";

import { DrawnSpinner, QuietSpinner, type Spinner } from "../../../../src/lib/ui/spinner";

/** The handle clack handed back to the last spinner that was started. */
const handle = () => vi.mocked(spinner).mock.results.at(-1)?.value as ReturnType<typeof spinner>;

afterEach(() => {
  vi.clearAllMocks();
});

describe("DrawnSpinner", () => {
  it("is spinning as soon as it exists, under the label it was given", () => {
    new DrawnSpinner("Fetching users");

    expect(handle().start).toHaveBeenCalledWith("Fetching users");
  });

  it("runs in the chain's gutter unless it is told not to", () => {
    new DrawnSpinner("Fetching users");

    expect(spinner).toHaveBeenCalledWith({ withGuide: true });
  });

  it("stays out of the gutter for work that clears itself", () => {
    // A cleared spinner that drew a guide line leaves that line behind.
    new DrawnSpinner("Checking for a local Zitadel server", false);

    expect(spinner).toHaveBeenCalledWith({ withGuide: false });
  });

  it("renames itself while the work goes on", () => {
    new DrawnSpinner("Fetching users").message("Fetching users — page 2");

    expect(handle().message).toHaveBeenCalledWith("Fetching users — page 2");
  });

  it("leaves a line when it is stopped", () => {
    new DrawnSpinner("Fetching users").stop("Fetched 3 users");

    expect(handle().stop).toHaveBeenCalledWith("Fetched 3 users");
  });

  it("leaves nothing behind when it is cleared", () => {
    new DrawnSpinner("Fetching users").clear();

    expect(handle().clear).toHaveBeenCalled();
  });
});

describe("QuietSpinner", () => {
  it("draws nothing, whatever it is asked to do", () => {
    const quiet: Spinner = new QuietSpinner();
    quiet.message("Fetching users — page 2");
    quiet.stop("Fetched 3 users");
    quiet.clear();

    expect(spinner).not.toHaveBeenCalled();
  });
});
