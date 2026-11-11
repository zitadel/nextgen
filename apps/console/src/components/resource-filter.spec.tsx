import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { FilterDefinition } from "@/lib/resource-filter";

import { ResourceFilter } from "./resource-filter";

const FILTERS: FilterDefinition[] = [
  {
    type: "options",
    key: "kind",
    label: "Kind",
    clears: ["size"],
    options: [
      { value: "fruit", label: "Fruit" },
      { value: "veg", label: "Vegetable" },
    ],
  },
  {
    type: "options",
    key: "size",
    label: "Size",
    unavailable: "Choose a kind first",
    options: [{ value: "l", label: "Large" }],
  },
  { type: "date", key: "picked", label: "Picked" },
];

/** The filter over values a screen would keep in its URL; `onChange` sees each patch. */
function renderFilter(initial: Record<string, string | undefined> = {}, filters = FILTERS) {
  const onChange = vi.fn();
  function Harness() {
    const [values, setValues] = useState(initial);
    return (
      <ResourceFilter
        filters={filters}
        values={values}
        onChange={(patch) => {
          onChange(patch);
          setValues((prev) => ({ ...prev, ...patch }));
        }}
      />
    );
  }
  render(<Harness />);
  return onChange;
}

describe("ResourceFilter", () => {
  it("lists the properties, then the chosen property's values, and sets the one picked", async () => {
    const onChange = renderFilter();
    await userEvent.click(screen.getByRole("button", { name: "Add filter" }));
    const properties = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(properties.map((option) => option.textContent)).toEqual([
      "Kind",
      "SizeChoose a kind first",
      "Picked",
    ]);
    // A property that cannot be chosen yet says why.
    expect(properties[1]).toHaveAttribute("aria-disabled", "true");

    await userEvent.click(properties[0]!);
    await userEvent.click(await screen.findByRole("option", { name: "Vegetable" }));
    // A new kind clears the size that belonged to the last one.
    expect(onChange).toHaveBeenLastCalledWith({ size: undefined, kind: "veg" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: /^Kind/ })).toHaveTextContent("KindVegetable");
  });

  it("finds a property and a value by typing, and steps back to the properties", async () => {
    renderFilter();
    await userEvent.click(screen.getByRole("button", { name: "Add filter" }));
    await userEvent.keyboard("kin");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Kind"]);
    await userEvent.keyboard("{Enter}");

    // The values' own field takes the focus the properties' field held.
    await userEvent.keyboard("veg");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Vegetable",
    ]);

    await userEvent.click(screen.getByRole("button", { name: "All filters" }));
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("reopens a set filter on its values alone, and clears it from its cross", async () => {
    const onChange = renderFilter({ kind: "fruit" });
    await userEvent.click(screen.getByRole("button", { name: /^Kind/ }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Fruit",
      "Vegetable",
    ]);
    expect(screen.queryByRole("button", { name: "All filters" })).toBeNull();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("button", { name: "Clear the kind filter" }));
    expect(onChange).toHaveBeenLastCalledWith({ size: undefined, kind: undefined });
    expect(screen.queryByRole("group", { name: "Kind filter" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add filter" })).toHaveFocus();
  });

  it("changes nothing when the value a filter already has is picked again", async () => {
    // Nothing that depends on it is cleared either: the size stays.
    const onChange = renderFilter({ kind: "fruit", size: "l" });
    await userEvent.click(screen.getByRole("button", { name: /^Kind/ }));
    await userEvent.click(screen.getByRole("option", { name: "Fruit" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: /^Size/ })).toHaveTextContent("SizeLarge");
  });

  it("names the menu by the step it is on", async () => {
    renderFilter();
    await userEvent.click(screen.getByRole("button", { name: "Add filter" }));
    expect(screen.getByRole("dialog", { name: "Filter by" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "Kind" }));
    expect(screen.getByRole("dialog", { name: "Kind" })).toBeInTheDocument();
  });

  it("shows a value no option matches, so it can be cleared", () => {
    renderFilter({ kind: "ghost" });
    expect(screen.getByRole("button", { name: /^Kind/ })).toHaveTextContent("Kindghost");
    expect(screen.getByRole("button", { name: "Clear the kind filter" })).toBeInTheDocument();
  });

  it("offers a date its ranges, and a day to start from", async () => {
    const onChange = renderFilter();
    await userEvent.click(screen.getByRole("button", { name: "Add filter" }));
    await userEvent.click(screen.getByRole("option", { name: "Picked" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Last 24 hours",
      "Last 7 days",
      "Last 30 days",
      "Last 90 days",
    ]);
    await userEvent.click(screen.getByRole("option", { name: "Last 30 days" }));
    expect(onChange).toHaveBeenLastCalledWith({ picked: "30d" });
    expect(screen.getByRole("button", { name: /^Picked/ })).toHaveTextContent("PickedLast 30 days");

    // From the chip, a day replaces the range. A day yet to come cannot be applied.
    await userEvent.click(screen.getByRole("button", { name: /^Picked/ }));
    const day = screen.getByLabelText("Since a day");
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();
    fireEvent.change(day, { target: { value: "2999-01-01" } });
    expect(apply).toBeDisabled();
    fireEvent.change(day, { target: { value: "2026-01-05" } });
    await userEvent.click(apply);
    expect(onChange).toHaveBeenLastCalledWith({ picked: "2026-01-05" });
  });
});
