import { describe, expect, it } from "vitest";

import { ApiError } from "./api-error";

class ThingNotFoundError extends ApiError {
  override readonly name = "ThingNotFoundError";
}

describe("ApiError.withMessage", () => {
  it("is the same class and fields with another message, as a new error", () => {
    const original = new ThingNotFoundError(
      404,
      "http://x/p",
      { code: "proj.not_found" },
      "GET returned 404",
      "req_1",
    );

    const restated = original.withMessage("no such project");

    expect(restated).not.toBe(original);
    expect(restated).toBeInstanceOf(ThingNotFoundError);
    expect(restated).toMatchObject({
      name: "ThingNotFoundError",
      message: "no such project",
      status: 404,
      url: "http://x/p",
      body: { code: "proj.not_found" },
      requestId: "req_1",
    });
    expect(original.message).toBe("GET returned 404");
  });

  it("keeps a plain ApiError plain", () => {
    expect(new ApiError(500, "u", undefined, "m").withMessage("n").constructor).toBe(ApiError);
  });
});
