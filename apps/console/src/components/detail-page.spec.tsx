import { render, screen } from "@testing-library/react";
import { Box } from "lucide-react";
import { describe, expect, it } from "vitest";

import { MetaRule, MetaValue } from "./detail-meta";
import { DetailHeader, DetailPage } from "./detail-page";

function renderHeader(props: Partial<Parameters<typeof DetailHeader>[0]> = {}) {
  render(
    <DetailPage>
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
    </DetailPage>,
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
