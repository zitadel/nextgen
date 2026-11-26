import { track } from "@vercel/analytics";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pageOf, snippetOf, trackEvent } from "./analytics";
import * as offered from "./commands";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

describe("snippetOf", () => {
  it("names every command the website offers to copy", () => {
    // Every exported command but the folder's, which only /llms.txt shows.
    const commands = Object.entries(offered).flatMap(([name, value]) =>
      name.endsWith("Command") && name !== "folderCommand" && typeof value === "string"
        ? [value]
        : [],
    );
    expect(commands.length).toBeGreaterThan(10);
    for (const command of commands) {
      expect(snippetOf(command), command).toBeDefined();
    }
  });

  it("names no other text", () => {
    expect(snippetOf("npx @zitadel/cli@latest doctor")).toBeUndefined();
  });
});

describe("pageOf", () => {
  it("calls the root home and any other page by its first segment", () => {
    expect(pageOf("/")).toBe("home");
    expect(pageOf("/changelog")).toBe("changelog");
    expect(pageOf("/changelog/zitadel-deploy")).toBe("changelog");
  });

  it("calls a feature page by its two segments", () => {
    expect(pageOf("/platform/sign-in")).toBe("platform/sign-in");
    expect(pageOf("/platform")).toBe("platform");
  });
});

describe("trackEvent", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { pathname: "/" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.mocked(track).mockClear();
  });

  it("sends the header, the page and the event's properties", () => {
    vi.stubEnv("WEBSITE_VERSION", "fa1eade");
    trackEvent("copied_command", { snippet: "setup", placement: "hero" });
    expect(track).toHaveBeenCalledWith("copied_command", {
      surface: "website",
      website_version: "fa1eade",
      page: "home",
      snippet: "setup",
      placement: "hero",
    });
  });

  it("leaves the version out where the build knew no commit", () => {
    vi.stubEnv("WEBSITE_VERSION", "");
    trackEvent("clicked_link", { target: "github", placement: "showcase" });
    expect(track).toHaveBeenCalledWith("clicked_link", {
      surface: "website",
      page: "home",
      target: "github",
      placement: "showcase",
    });
  });
});
