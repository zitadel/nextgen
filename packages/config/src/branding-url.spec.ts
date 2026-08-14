import { describe, expect, it } from "vitest";

import { isCanonicalLoopbackHttpUrl } from "./branding-url.js";

describe("isCanonicalLoopbackHttpUrl", () => {
  it.each([
    "http://localhost/logo.svg",
    "HTTP://LOCALHOST:3000/logo.svg",
    "http://127.0.0.1:8080/logo.svg",
    "http://127.255.255.255/logo.svg",
    "http://[::1]:3000/logo.svg",
  ])("accepts %s", (value) => {
    expect(isCanonicalLoopbackHttpUrl(value)).toBe(true);
  });

  it.each([
    "https://localhost/logo.svg",
    "http://localhost.evil.example/logo.svg",
    "http://localhost:3000@evil.example/logo.svg",
    "http://192.168.1.10/logo.svg",
    "http://127.1/logo.svg",
    "http://2130706433/logo.svg",
    "http://0x7f000001/logo.svg",
    "http://127.00.0.1/logo.svg",
    "http://127.999.1.1/logo.svg",
    "http://[0:0:0:0:0:0:0:1]/logo.svg",
    "http://[::ffff:127.0.0.1]/logo.svg",
    "http://localhost:/logo.svg",
    "http://localhost:65536/logo.svg",
  ])("rejects %s", (value) => {
    expect(isCanonicalLoopbackHttpUrl(value)).toBe(false);
  });
});
