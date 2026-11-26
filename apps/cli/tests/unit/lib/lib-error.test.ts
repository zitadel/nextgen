import { describe, expect, it } from "vitest";

import type { ErrorCategory, ZitadelErrorCode } from "@/lib/errors";
import { ZitadelLibError } from "@/lib/lib-error";

/** An error with facts of its own, as a package declares one. */
class SampleError extends ZitadelLibError {
  override readonly category: ErrorCategory = "invalid";
  override readonly retryable: boolean = false;
  override readonly code: ZitadelErrorCode = "E_VALIDATION";

  /** A fact a report shows. */
  readonly lockFile: string;

  /** A fact it has no value for. */
  readonly ownerPid: number | undefined;

  /**
   * Make the sample.
   *
   * @param lockFile - A fact a report shows.
   */
  constructor(lockFile: string) {
    super("busy", new Error("underneath"));
    this.lockFile = lockFile;
    this.ownerPid = undefined;
  }
}

describe("ZitadelLibError", () => {
  it("reports each field it has a value for as a fact, keyed in snake_case", () => {
    expect(new SampleError("/w/start.lock").details).toEqual({ lock_file: "/w/start.lock" });
  });

  it("states no hint unless its class gives one", () => {
    expect(new SampleError("/w/start.lock").hint).toBeUndefined();
  });
});
