import assert from "node:assert/strict";
import { test } from "vitest";

import { isLoggedOutUrl } from "./navigation.mjs";

test.each([false, true])(
  "logout rejects a signed-in URL (server routes: %s)",
  (protectedRoutes) => {
    assert.equal(isLoggedOutUrl(new URL("http://localhost:5173/profile"), protectedRoutes), false);
    assert.equal(isLoggedOutUrl(new URL("https://app.test/profile"), protectedRoutes), false);
    assert.equal(isLoggedOutUrl(new URL("https://app.test/login-other"), protectedRoutes), false);
    assert.equal(
      isLoggedOutUrl(new URL("https://app.test/login?next=/profile"), protectedRoutes),
      true,
    );
  },
);

test("only SPA journeys may finish logout at the app root", () => {
  assert.equal(isLoggedOutUrl(new URL("http://localhost:5173/"), false), true);
  assert.equal(isLoggedOutUrl(new URL("http://localhost:5173/"), true), false);
});
