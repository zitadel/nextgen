import { ApiError } from "@zitadel/api/runtime/fetch";
import { describe, expect, it } from "vitest";

import { formatDateTime } from "@/lib/date";

import {
  createBody,
  describeEventTypes,
  draftOf,
  EMPTY_DRAFT,
  isComplete,
  lastError,
  rotationInProgress,
  updateBody,
  type Webhook,
  webhookRefusal,
  webhookState,
} from "./model";

function webhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: "hook_1",
    project_id: "proj_test",
    url: "https://api.acme.com/hooks/zitadel",
    description: "User sync",
    event_types: ["user.created", "user.deleted"],
    enabled: true,
    last_delivered_at: null,
    last_error_status: null,
    last_error_at: null,
    previous_secret_expires_at: null,
    created_at: "2026-11-11T10:00:00Z",
    ...overrides,
  };
}

const EARLIER = "2026-11-11T10:00:00Z";
const LATER = "2026-11-11T10:05:00Z";

/** A refusal as the server sends it: `details.details` is the producer's. */
function refusal(status: number, code: string, message: string, producer?: unknown): ApiError {
  const body = { code, message, ...(producer ? { details: { details: producer } } : {}) };
  return new ApiError(status, "http://localhost/api/v1/webhooks", body, `POST returned ${status}`);
}

describe("webhookState", () => {
  it.each([
    ["nothing delivered and nothing failed", {}, "active"],
    ["a delivery and no failure", { last_delivered_at: EARLIER }, "active"],
    [
      "a failure a later delivery got past",
      { last_error_at: EARLIER, last_delivered_at: LATER },
      "active",
    ],
    ["a failure before any delivery", { last_error_at: EARLIER }, "failing"],
    [
      "a failure after the last delivery",
      { last_delivered_at: EARLIER, last_error_at: LATER },
      "failing",
    ],
    ["turned off while it delivered", { enabled: false, last_delivered_at: EARLIER }, "disabled"],
    [
      "turned off, an old failure behind it",
      { enabled: false, last_error_at: EARLIER, last_delivered_at: LATER },
      "disabled",
    ],
    [
      "off with its last attempt failed, as the server leaves it",
      { enabled: false, last_delivered_at: EARLIER, last_error_at: LATER },
      "stopped",
    ],
    ["off having never delivered", { enabled: false, last_error_at: EARLIER }, "stopped"],
  ] as const)("%s is %s", (_name, overrides, state) => {
    expect(webhookState(webhook(overrides))).toBe(state);
  });

  it("compares the moments, not their spelling", () => {
    // The same instant with and without a fraction: neither is later.
    const same = webhook({
      last_delivered_at: "2026-11-11T10:00:00Z",
      last_error_at: "2026-11-11T10:00:00.000Z",
    });
    expect(webhookState(same)).toBe("active");
  });
});

describe("lastError", () => {
  it("names the status the endpoint answered with", () => {
    const failing = webhook({ last_error_at: LATER, last_error_status: 503 });
    expect(lastError(failing)).toBe(
      `The attempt on ${formatDateTime(LATER)} was answered with 503.`,
    );
  });

  it("says there was no response when the status is null", () => {
    expect(lastError(webhook({ last_error_at: LATER }))).toBe(
      `The attempt on ${formatDateTime(LATER)} got no response.`,
    );
  });

  it("is silent once a later delivery succeeded", () => {
    const recovered = webhook({
      last_error_at: EARLIER,
      last_error_status: 500,
      last_delivered_at: LATER,
    });
    expect(lastError(recovered)).toBeUndefined();
  });
});

describe("describeEventTypes", () => {
  it.each([
    [["*"], "All events"],
    [["user.created"], "user.created"],
    [["user.created", "user.deleted", "request.api"], "3 event types"],
  ])("%j reads %s", (types, text) => {
    expect(describeEventTypes(types)).toBe(text);
  });
});

describe("rotationInProgress", () => {
  const now = new Date("2026-11-11T12:00:00Z");

  it("holds until the previous secret expires", () => {
    expect(rotationInProgress({ previous_secret_expires_at: "2026-11-12T10:00:00Z" }, now)).toBe(
      true,
    );
    expect(rotationInProgress({ previous_secret_expires_at: "2026-11-11T11:00:00Z" }, now)).toBe(
      false,
    );
    expect(rotationInProgress({ previous_secret_expires_at: null }, now)).toBe(false);
  });
});

describe("the form's draft", () => {
  it("starts on all events and cannot be sent without a URL", () => {
    expect(EMPTY_DRAFT.all).toBe(true);
    expect(isComplete(EMPTY_DRAFT)).toBe(false);
    expect(isComplete({ ...EMPTY_DRAFT, url: " https://a.example " })).toBe(true);
  });

  it("needs a type once events are selected", () => {
    const selected = { ...EMPTY_DRAFT, url: "https://a.example", all: false };
    expect(isComplete(selected)).toBe(false);
    expect(isComplete({ ...selected, types: ["user.created"] })).toBe(true);
  });

  it("creates with * for all events and leaves an empty description out", () => {
    expect(
      createBody({ url: " https://a.example ", description: " ", all: true, types: ["x.y"] }),
    ).toEqual({ url: "https://a.example", event_types: ["*"] });
  });

  it("creates with the chosen types and the description", () => {
    expect(
      createBody({
        url: "https://a.example",
        description: "Sync",
        all: false,
        types: ["user.created"],
      }),
    ).toEqual({ url: "https://a.example", event_types: ["user.created"], description: "Sync" });
  });

  it("reads * back as all events", () => {
    expect(draftOf(webhook({ event_types: ["*"] }))).toMatchObject({ all: true, types: [] });
    expect(draftOf(webhook())).toMatchObject({
      all: false,
      types: ["user.created", "user.deleted"],
    });
  });

  it("updates nothing while nothing changed", () => {
    const saved = webhook();
    expect(updateBody(saved, draftOf(saved))).toBeUndefined();
    // The order the types were ticked in is not a change.
    expect(
      updateBody(saved, { ...draftOf(saved), types: ["user.deleted", "user.created"] }),
    ).toBeUndefined();
  });

  it("sends only the fields that changed", () => {
    const saved = webhook({ event_types: ["user.created", "retired.type"] });
    // The types are left out, so a type the server no longer writes is not
    // sent back to be refused.
    expect(updateBody(saved, { ...draftOf(saved), url: "https://b.example" })).toEqual({
      url: "https://b.example",
    });
    expect(updateBody(saved, { ...draftOf(saved), description: "" })).toEqual({
      description: "",
    });
    expect(updateBody(saved, { ...draftOf(saved), all: true })).toEqual({ event_types: ["*"] });
  });
});

describe("webhookRefusal", () => {
  it("puts webhook.invalid on the field it names", () => {
    const cause = refusal(400, "webhook.invalid", "the url is not a URL with a host", {
      field: "url",
    });
    expect(webhookRefusal(cause, "fallback")).toEqual({
      message: "the url is not a URL with a host",
      field: "url",
    });
  });

  it("reads an entry of the list as the events field", () => {
    const cause = refusal(400, "webhook.invalid", "not an event type", {
      field: "event_types[2]",
    });
    expect(webhookRefusal(cause, "fallback").field).toBe("event_types");
  });

  it("reads the fields a body the contract refuses names", () => {
    const cause = refusal(400, "req.invalid", "The request is invalid.", { fields: ["url"] });
    expect(webhookRefusal(cause, "fallback").field).toBe("url");
  });

  it("leaves a refusal that names no field to the form", () => {
    const limit = refusal(409, "webhook.limit_reached", "the project has reached its limit");
    expect(webhookRefusal(limit, "fallback")).toEqual({
      message: "the project has reached its limit",
    });
    const other = refusal(400, "req.invalid", "The request is invalid.", { fields: ["enabled"] });
    expect(webhookRefusal(other, "fallback")).toEqual({ message: "The request is invalid." });
  });

  it("falls back when the failure carried no message", () => {
    expect(webhookRefusal(new TypeError("x"), "fallback").message).toBe("x");
    expect(webhookRefusal(refusal(500, "internal", ""), "Could not save.")).toEqual({
      message: "Could not save.",
    });
  });
});
