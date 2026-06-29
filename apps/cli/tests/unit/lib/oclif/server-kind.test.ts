import { describe, expect, it } from "vitest";

import { serverKind } from "../../../../src/lib/oclif/server-kind";

describe("serverKind", () => {
  it("buckets sources without leaking the URL", () => {
    expect(serverKind.value("https://api.zitadel.cloud")).toBe("cloud");
    expect(serverKind.value("https://acme.zitadel.cloud")).toBe("cloud");
    expect(serverKind.value("http://localhost:8080")).toBe("local");
    expect(serverKind.value("http://127.0.0.1:8080")).toBe("local");
    expect(serverKind.value("mock")).toBe("local");
    expect(serverKind.value("https://auth.internal.acme.com")).toBe("self_hosted");
    expect(serverKind.value("not a url")).toBe("unknown");
  });

  it("does not classify lookalike domains as cloud", () => {
    expect(serverKind.value("https://foozitadel.cloud")).toBe("self_hosted");
    expect(serverKind.value("https://notzitadel.cloud")).toBe("self_hosted");
    expect(serverKind.value("https://zitadel.cloud")).toBe("cloud");
  });
});
