import { describe, expect, it } from "vitest";

import {
  buildCimdClientMetadata,
  cimdClientIdUrl,
  cimdRedirectUri,
  isCimdCompatibleOrigin,
} from "./cimd.js";

describe("cimd helpers", () => {
  it("detects https public origins", () => {
    expect(isCimdCompatibleOrigin("https://mcp.example.com")).toBe(true);
    expect(isCimdCompatibleOrigin("http://localhost:9090")).toBe(false);
    expect(isCimdCompatibleOrigin("https://fc12.ngrok-free.app")).toBe(true);
  });

  it("builds origin-matched client metadata URLs", () => {
    const origin = "https://mcp.example.com";
    expect(cimdClientIdUrl(origin)).toBe("https://mcp.example.com/.well-known/oauth-client");
    expect(cimdRedirectUri(origin)).toBe("https://mcp.example.com/oauth/callback");
    expect(buildCimdClientMetadata(origin).redirect_uris).toEqual([
      "https://mcp.example.com/oauth/callback",
    ]);
  });
});
