import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RuntimeUnavailable } from "./runtime-unavailable";

/**
 * The boot-time connectivity screen (Console ADR 0004 §3). What matters here
 * is that it names the actual failure — a status or a transport error, never
 * "no project yet" — and that retry is a real second attempt rather than copy
 * telling the operator to reload.
 */
describe("runtime unavailable screen", () => {
  it("names the failure the server produced", () => {
    render(
      <RuntimeUnavailable
        failure={{ status: 500, detail: "the server answered 500" }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Server unavailable" })).toBeInTheDocument();
    expect(screen.getByText(/the server answered 500/)).toBeInTheDocument();
    // The state this screen exists to be told apart from.
    expect(screen.queryByText(/no project yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/zitadel setup/i)).not.toBeInTheDocument();
  });

  it("retries discovery and reports progress while the attempt is in flight", async () => {
    const user = userEvent.setup();
    let releaseRetry: (() => void) | undefined;
    const onRetry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseRetry = resolve;
        }),
    );

    render(
      <RuntimeUnavailable failure={{ detail: "the request failed (network down)" }} onRetry={onRetry} />,
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledOnce();
    const retrying = await screen.findByRole("button", { name: "Retrying…" });
    expect(retrying).toBeDisabled();

    releaseRetry?.();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeEnabled();
  });
});
