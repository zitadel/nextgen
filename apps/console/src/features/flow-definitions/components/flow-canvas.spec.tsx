import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { FlowDefinition } from "../model";
import { FlowCanvas } from "./flow-canvas";

const DEFINITION: FlowDefinition = {
  name: "sign-in",
  user_schema: "human-user",
  purposes: { login: "identifier" },
  steps: [
    {
      name: "identifier",
      fields: ["email"],
      actions: [{ name: "submit", kind: "submit", primary: true }],
      sso_providers: ["google"],
      transitions: { submit: { target: "done" } },
    },
    { name: "done", complete: "show" },
    { name: "unreached", fields: ["email"] },
  ],
};

describe("FlowCanvas", () => {
  it("sketches each step with its fields, actions, providers and footer", () => {
    render(<FlowCanvas definition={DEFINITION} name="Sign in" />);
    const step = within(screen.getByRole("article", { name: "Step identifier" }));
    expect(step.getByText("email")).toBeInTheDocument();
    expect(step.getByText("google")).toBeInTheDocument();
    const done = within(screen.getByRole("article", { name: "Step done" }));
    expect(done.getByText("complete")).toBeInTheDocument();
    expect(done.getByText("show")).toBeInTheDocument();
    // The transition's name is on its arrow, beside the button that fires it.
    const canvas = within(screen.getByRole("region", { name: "Flow canvas" }));
    expect(canvas.getAllByText("submit")).toHaveLength(2);
  });

  it("paints the cards in the project's branding for the console's side", () => {
    document.documentElement.dataset.theme = "light";
    const { unmount } = render(
      <FlowCanvas
        definition={DEFINITION}
        name="Sign in"
        branding={{
          theme: {
            light: { palette: { primary: "#ff0000" }, logo_url: "https://example.com/logo.svg" },
          },
        }}
      />,
    );
    const step = screen.getByRole("article", { name: "Step identifier" });
    expect(step.style.getPropertyValue("--zl-primary")).toBe("#ff0000");
    expect(step.querySelector("img")).toHaveAttribute("src", "https://example.com/logo.svg");
    unmount();
    delete document.documentElement.dataset.theme;
  });

  it("dims what a focused step has no transition to or from", async () => {
    const user = userEvent.setup();
    render(<FlowCanvas definition={DEFINITION} name="Sign in" />);
    await user.click(screen.getByRole("article", { name: "Step identifier" }));
    expect(screen.getByRole("article", { name: "Step identifier" })).not.toHaveClass("opacity-15");
    expect(screen.getByRole("article", { name: "Step done" })).not.toHaveClass("opacity-15");
    expect(screen.getByRole("article", { name: "Step unreached" })).toHaveClass("opacity-15");
  });

  it("zooms by its controls", async () => {
    const user = userEvent.setup();
    render(<FlowCanvas definition={DEFINITION} name="Sign in" />);
    const level = screen.getByRole("status", { name: "Zoom" });
    // An unlaid-out viewport fits at 100%.
    expect(level).toHaveTextContent("100%");
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(level).toHaveTextContent("90%");
    await user.click(screen.getByRole("button", { name: "Fit" }));
    expect(level).toHaveTextContent("100%");
  });

  it("zooms by ctrl or cmd and the wheel, and leaves a plain wheel to scroll", () => {
    render(<FlowCanvas definition={DEFINITION} name="Sign in" />);
    const region = screen.getByRole("region", { name: "Flow canvas" });
    const plain = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
    act(() => {
      region.dispatchEvent(plain);
    });
    expect(plain.defaultPrevented).toBe(false);
    expect(screen.getByRole("status", { name: "Zoom" })).toHaveTextContent("100%");

    const zooming = new WheelEvent("wheel", {
      deltaY: 100,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      region.dispatchEvent(zooming);
    });
    expect(zooming.defaultPrevented).toBe(true);
    expect(screen.getByRole("status", { name: "Zoom" })).toHaveTextContent("86%");
  });

  it("zooms by the keyboard while the canvas has focus", async () => {
    const user = userEvent.setup();
    render(<FlowCanvas definition={DEFINITION} name="Sign in" />);
    screen.getByRole("region", { name: "Flow canvas" }).focus();
    const level = screen.getByRole("status", { name: "Zoom" });
    await user.keyboard("-");
    expect(level).toHaveTextContent("90%");
    await user.keyboard("+");
    await user.keyboard("+");
    expect(level).toHaveTextContent("110%");
    await user.keyboard("0");
    expect(level).toHaveTextContent("100%");
  });

  it("opens full screen at 100% and leaves it by Escape or by its button", async () => {
    const user = userEvent.setup();
    render(<FlowCanvas definition={DEFINITION} name="Sign in" />);
    const open = screen.getByRole("button", { name: "Full screen" });
    await user.click(screen.getByRole("button", { name: "Zoom out" }));

    await user.click(open);
    const dialog = within(screen.getByRole("dialog", { name: "Sign in" }));
    expect(dialog.getByRole("button", { name: "Exit full screen" })).toHaveFocus();
    expect(dialog.getByRole("status", { name: "Zoom" })).toHaveTextContent("100%");
    // The zoom keys work from anywhere in full screen.
    await user.keyboard("-");
    expect(dialog.getByRole("status", { name: "Zoom" })).toHaveTextContent("90%");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(open).toHaveFocus();

    await user.click(open);
    await user.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // The card's own viewport is back, and still zooms.
    const zooming = new WheelEvent("wheel", {
      deltaY: 100,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      screen.getByRole("region", { name: "Flow canvas" }).dispatchEvent(zooming);
    });
    expect(zooming.defaultPrevented).toBe(true);
    expect(screen.getByRole("status", { name: "Zoom" })).toHaveTextContent("86%");
  });
});
