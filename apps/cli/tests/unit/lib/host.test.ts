import { describe, expect, it } from "vitest";

import { isLoopbackHost } from "@/lib/host";

describe("isLoopbackHost", () => {
  it.for(["localhost", "127.0.0.1", "127.1.2.3", "::1", "[::1]"])("accepts %s", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.for(["example.com", "10.0.0.1", "0.0.0.0", "*", "", "1270.0.0.1", "localhost.example.com"])(
    "rejects %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});
