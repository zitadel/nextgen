import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { trackEvent } from "@/lib/analytics";

import { NewProjectCard } from "./new-project-card";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

describe("NewProjectCard", () => {
  it("reports the setup command once it is on the clipboard", async () => {
    const user = userEvent.setup();
    render(<NewProjectCard />);

    await user.click(screen.getByRole("button", { name: "Copy the setup command" }));

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith("copied_command", {
        page: "projects",
        snippet: "setup",
      }),
    );
    expect(await navigator.clipboard.readText()).toMatch(/^npx @zitadel\/cli@latest setup /);
  });
});
