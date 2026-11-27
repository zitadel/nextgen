import { describe, expect, it, vi } from "vitest";

import { currentUser } from "@/lib/uidgid";

describe("currentUser", () => {
  it("is this process's user and group", () => {
    vi.spyOn(process, "getuid").mockReturnValue(501);
    vi.spyOn(process, "getgid").mockReturnValue(20);

    expect(currentUser()).toEqual({ uid: 501, gid: 20 });
  });

  it("uses the user id as the group where the platform has no group id", () => {
    vi.spyOn(process, "getuid").mockReturnValue(501);
    vi.stubGlobal("process", { ...process, getuid: () => 501, getgid: undefined });

    expect(currentUser()).toEqual({ uid: 501, gid: 501 });
  });

  it("is empty where the platform has no user ids", () => {
    vi.stubGlobal("process", { ...process, getuid: undefined, getgid: undefined });

    expect(currentUser()).toEqual({});
  });
});
