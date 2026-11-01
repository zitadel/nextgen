import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Select, SelectContent } from "@/components/ui/select";
import { formatDateTime } from "@/lib/date";

import { RevisionBadges, RevisionItems, shortRevisionId } from "./revision-select";

const NEWEST = { id: "sch_01M62294FC71CAD2XY0TZNP02S", createdAt: "2026-08-01T09:30:00Z" };
const MIDDLE = {
  id: "sch_01M62293CRKVYE2DYTJZ0A3PJF",
  createdAt: "2026-07-15T12:00:00Z",
  inUse: true,
};
const OLDEST = { id: "sch_01M62291AAAAAAAAAAAAAAAAAA", createdAt: "2026-07-01T00:00:00Z" };

describe("shortRevisionId", () => {
  it("keeps the prefix and the last six characters of a ULID id", () => {
    expect(shortRevisionId("sch_01M62294FC71CAD2XY0TZNP02S")).toBe("sch_…ZNP02S");
  });

  it("leaves an id whole up to ten characters after its prefix", () => {
    expect(shortRevisionId("sch_business")).toBe("sch_business");
    expect(shortRevisionId("sch_0123456789")).toBe("sch_0123456789");
    expect(shortRevisionId("sch_01234567890")).toBe("sch_…567890");
  });

  it("leaves an id with no prefix whole, such as a URI", () => {
    expect(shortRevisionId("default")).toBe("default");
    expect(shortRevisionId("https://example.com/schemas/staff-v2")).toBe(
      "https://example.com/schemas/staff-v2",
    );
  });
});

describe("RevisionBadges", () => {
  it("marks the newest revision Latest and one some user is on In use, together when both hold", () => {
    const { rerender } = render(
      <RevisionBadges revisions={[{ ...NEWEST, inUse: true }, OLDEST]} id={NEWEST.id} />,
    );
    expect(screen.getByText("Latest")).toBeInTheDocument();
    expect(screen.getByText("In use")).toBeInTheDocument();

    rerender(<RevisionBadges revisions={[NEWEST, MIDDLE, OLDEST]} id={OLDEST.id} />);
    expect(screen.queryByText("Latest")).not.toBeInTheDocument();
    expect(screen.queryByText("In use")).not.toBeInTheDocument();
  });

  it("marks nothing on an id the history does not list", () => {
    render(<RevisionBadges revisions={[{ ...NEWEST, inUse: true }]} id="sch_ghost" />);
    expect(screen.queryByText("Latest")).not.toBeInTheDocument();
    expect(screen.queryByText("In use")).not.toBeInTheDocument();
  });
});

describe("RevisionItems", () => {
  it("shows each revision by its short id, creation time and badges, keeping the full id in its title", () => {
    render(
      <Select open value={MIDDLE.id}>
        <SelectContent>
          <RevisionItems revisions={[NEWEST, MIDDLE, OLDEST]} />
        </SelectContent>
      </Select>,
    );
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => [option.getAttribute("title"), option.textContent])).toEqual([
      [NEWEST.id, `sch_…ZNP02S${formatDateTime(NEWEST.createdAt)}Latest`],
      [MIDDLE.id, `sch_…0A3PJF${formatDateTime(MIDDLE.createdAt)}In use`],
      [OLDEST.id, `sch_…AAAAAA${formatDateTime(OLDEST.createdAt)}`],
    ]);
  });
});
