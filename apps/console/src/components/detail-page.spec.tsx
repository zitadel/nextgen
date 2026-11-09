import { render, screen } from "@testing-library/react";
import { Box } from "lucide-react";
import { describe, expect, it } from "vitest";

import { MetaRule, MetaValue } from "./detail-meta";
import { DetailHeader, DetailRow, DetailRows } from "./detail-page";
import { Page } from "./layout";

function renderHeader(props: Partial<Parameters<typeof DetailHeader>[0]> = {}) {
  render(
    <Page>
      <DetailHeader
        icon={Box}
        title="Engineering"
        meta={
          <>
            <MetaValue label="Team ID" value="team_01" copyable />
            <MetaRule />
            <MetaValue label="Created" value="Jul 12, 2026" />
          </>
        }
        {...props}
      />
    </Page>,
  );
}

describe("detail header", () => {
  it("titles the screen with the resource's name as its only heading", () => {
    renderHeader();
    expect(screen.getByRole("heading", { level: 1, name: "Engineering" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("carries the identifying values in the header card", () => {
    renderHeader();
    expect(screen.getByText("team_01")).toBeInTheDocument();
    expect(screen.getByText("Jul 12, 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Team ID" })).toBeInTheDocument();
  });

  it("renders the status beside the title and the subtitle beneath it", () => {
    renderHeader({ status: <span>Active</span>, subtitle: "maya@acme.com" });
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("maya@acme.com")).toBeInTheDocument();
  });

  it("leaves out the subtitle line when there is none", () => {
    renderHeader();
    expect(screen.queryByRole("paragraph")).not.toBeInTheDocument();
  });

  it("keeps the icon out of the accessibility tree", () => {
    const { container } = render(
      <DetailHeader icon={Box} title="Engineering" meta={<MetaValue label="ID" value="x" />} />,
    );
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("detail header action", () => {
  it("renders the action after the header card", () => {
    renderHeader({ action: <button type="button">Actions</button> });
    const action = screen.getByRole("button", { name: "Actions" });
    const copy = screen.getByRole("button", { name: "Copy Team ID" });
    expect(copy.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("detail rows", () => {
  it("rules between rows, never after the last", () => {
    const { container } = render(
      <DetailRows>
        <DetailRow label="Message">a</DetailRow>
        <DetailRow label="Git commit">b</DetailRow>
        <DetailRow label="Created by">c</DetailRow>
      </DetailRows>,
    );
    const list = container.firstElementChild;
    expect(container.querySelectorAll("[data-slot=separator]")).toHaveLength(2);
    expect(list?.lastElementChild).toHaveTextContent("Created by");
  });

  it("keeps a list a list: rules are presentational items", () => {
    render(
      <DetailRows as="ul">
        <DetailRow label="Password">Not set</DetailRow>
        <DetailRow label="Passkey">Not set up</DetailRow>
      </DetailRows>,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("detail rows on their own width", () => {
  it("lays nested rows out on the list's width, not the viewport's", () => {
    const { container } = render(
      <DetailRows container>
        <DetailRow label="Length">15 characters</DetailRow>
      </DetailRows>,
    );
    const list = container.firstElementChild;
    expect(list).toHaveClass("@container/detail-rows");
    const row = list?.firstElementChild;
    expect(row).toHaveClass("@md/detail-rows:flex-row");
    expect(row).not.toHaveClass("sm:flex-row");
  });
});
