import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadEvents } from "./export";
import type { LogEvent } from "./model";

const EVENT = {
  id: "evt_1",
  project_id: "proj_test",
  event_type: "user.deleted",
  category: "entity",
  occurred_at: "2026-11-10T08:15:43Z",
  created_at: "2026-11-10T08:15:43Z",
  client_id: "",
  payload: {},
} as LogEvent;

describe("downloadEvents", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("saves the events through a link in the document, and keeps the blob until the download has started", () => {
    vi.useFakeTimers();
    const blobs: Blob[] = [];
    const revoke = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        return "blob:events";
      },
      revokeObjectURL: revoke,
    });
    // What the link was when it was clicked: its file, and whether it was in
    // the document, which Firefox needs to start a download.
    const clicked: { download: string; href: string; attached: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({
        download: this.download,
        href: this.getAttribute("href") ?? "",
        attached: this.isConnected,
      });
    });

    downloadEvents([EVENT], "csv");

    expect(clicked).toHaveLength(1);
    expect(clicked[0]).toMatchObject({ href: "blob:events", attached: true });
    expect(clicked[0]?.download).toMatch(/^events-.*\.csv$/);
    expect(blobs[0]?.type).toBe("text/csv");
    // The link does not stay in the page.
    expect(document.querySelector("a[download]")).toBeNull();
    // A blob revoked in the same tick can be gone before the browser reads it.
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:events");
  });
});
