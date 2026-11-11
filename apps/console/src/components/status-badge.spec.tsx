import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge, statusTone } from "./status-badge";

describe("status tones", () => {
  it("gives a status the tone of what it means", () => {
    expect(statusTone("active")).toBe("positive");
    expect(statusTone("live")).toBe("positive");
    expect(statusTone("suspended")).toBe("caution");
    expect(statusTone("pending_purge")).toBe("critical");
    for (const off of ["deactivated", "inactive", "draft"]) {
      expect(statusTone(off)).toBe("neutral");
    }
  });

  it("claims no meaning for a status it does not know", () => {
    expect(statusTone("quarantined")).toBe("neutral");
    // The server's string, not a property of the table it is looked up in.
    expect(statusTone("constructor")).toBe("neutral");
  });

  it("colours the pill's dot by the tone, and words it as the API does", () => {
    render(<StatusBadge status="pending_purge" />);
    const pill = screen.getByText("pending purge");
    expect(pill.querySelector("[data-tone]")).toHaveAttribute("data-tone", "critical");
    expect(pill.querySelector("[data-tone]")).toHaveClass("bg-destructive");
  });

  it("draws no pill for a record without a status", () => {
    render(<StatusBadge />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
