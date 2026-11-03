import { describe, expect, it } from "vitest";

import {
  authorizationServerMetadataUrl,
  protectedResourceMetadataUrl,
} from "../../../../src/lib/login/discovery";

describe("authorizationServerMetadataUrl", () => {
  it("is the root document for an issuer without a path, as the platform project's is", () => {
    expect(authorizationServerMetadataUrl("https://z.example")).toBe(
      "https://z.example/.well-known/oauth-authorization-server",
    );
  });

  it("inserts the well-known segment before an issuer's path (RFC 8414 §3.1)", () => {
    expect(authorizationServerMetadataUrl("https://z.example/oauth/proj_x/")).toBe(
      "https://z.example/.well-known/oauth-authorization-server/oauth/proj_x",
    );
  });
});

describe("protectedResourceMetadataUrl", () => {
  it("inserts the well-known segment before the API's path (RFC 9728 §3.1)", () => {
    expect(protectedResourceMetadataUrl("https://z.example/api/v1")).toBe(
      "https://z.example/.well-known/oauth-protected-resource/api/v1",
    );
  });
});
