import { track as vercelTrack } from "@vercel/analytics";
import { afterEach, describe, expect, it, vi } from "vitest";

import { track } from "./analytics";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

describe("track", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(vercelTrack).mockClear();
  });

  it("sends the header and the event's properties", () => {
    vi.stubEnv("CONSOLE_VERSION", "fa1eade");
    track("copied_command", { page: "projects", snippet: "setup" });
    expect(vercelTrack).toHaveBeenCalledWith("copied_command", {
      surface: "console",
      console_version: "fa1eade",
      server_kind: "cloud",
      page: "projects",
      snippet: "setup",
    });
  });

  it("leaves the version out where the build knew no commit", () => {
    vi.stubEnv("CONSOLE_VERSION", "");
    track("copied_command", { page: "projects", snippet: "setup" });
    expect(vercelTrack).toHaveBeenCalledWith("copied_command", {
      surface: "console",
      server_kind: "cloud",
      page: "projects",
      snippet: "setup",
    });
  });
});
