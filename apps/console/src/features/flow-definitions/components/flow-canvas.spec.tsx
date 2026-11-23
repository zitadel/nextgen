import { render, screen, within } from "@testing-library/react";
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
  ],
};

describe("FlowCanvas", () => {
  it("sketches each step with its fields, actions, providers and footer", () => {
    render(<FlowCanvas definition={DEFINITION} name="Sign in" />);
    const canvas = within(screen.getByRole("region", { name: "Flow canvas" }));
    expect(canvas.getByText("identifier")).toBeInTheDocument();
    expect(canvas.getByText("email")).toBeInTheDocument();
    expect(canvas.getByText("google")).toBeInTheDocument();
    expect(canvas.getByText("complete")).toBeInTheDocument();
    expect(canvas.getByText("show")).toBeInTheDocument();
    // The transition's name is on its arrow, beside the button that fires it.
    expect(canvas.getAllByText("submit")).toHaveLength(2);
  });

  it("opens full screen and leaves it by Escape or by its button", async () => {
    const user = userEvent.setup();
    render(<FlowCanvas definition={DEFINITION} name="Sign in" />);
    const open = screen.getByRole("button", { name: "Full screen" });

    await user.click(open);
    expect(screen.getByRole("dialog", { name: "Sign in canvas" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(open).toHaveFocus();

    await user.click(open);
    await user.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
