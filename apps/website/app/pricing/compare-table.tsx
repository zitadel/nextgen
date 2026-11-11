import { Fragment } from "react";

import { type Cell, type Group, type Row, type TierId, TIERS } from "./compare";
import { type FeatureStatus, statusTag } from "./status";

const TIER_NAMES: Record<TierId, string> = {
  free: "Free",
  addons: "Add-ons",
  enterprise: "Enterprise",
};

/**
 * The plans side by side, a group of rows per capability. From md up the plans'
 * names stick under the site's header (h-16) while the rows scroll; below md
 * the table scrolls sideways inside itself, never the page.
 */
export function CompareTable({
  groups,
  prices,
}: {
  groups: Group[];
  /** What each plan costs, under its name. */
  prices: Record<TierId, string>;
}) {
  return (
    // Relative, so the cells' sr-only labels, which are absolute, scroll
    // with the table rather than widening the page.
    <div className="relative mt-8 max-md:overflow-x-auto">
      <table className="w-full min-w-[46rem] table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-[28%]" />
          {TIERS.map((plan) => (
            <col key={plan} className="w-[24%]" />
          ))}
        </colgroup>
        <thead>
          <tr>
            <td className="sticky left-0 z-10 bg-background md:top-16" />
            {TIERS.map((plan) => (
              <th
                key={plan}
                scope="col"
                className="border-border-primary border-b bg-background px-3 py-4 text-left font-normal md:sticky md:top-16 md:z-10"
              >
                <span className="block font-heading text-text-primary text-xl leading-tight">
                  {TIER_NAMES[plan]}
                </span>
                <span className="mt-1 block text-text-muted text-xs leading-5">{prices[plan]}</span>
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.id}>
            <tr>
              <th scope="colgroup" colSpan={TIERS.length + 1} className="pt-12 pb-3 text-left">
                {/* Below md the title keeps to the screen while the plans scroll. */}
                <div className="max-md:sticky max-md:left-0 max-md:w-[calc(100vw-3rem)]">
                  <span className="font-heading font-normal text-2xl text-text-primary leading-tight">
                    {group.title}
                  </span>
                </div>
              </th>
            </tr>
            {group.rows.map((row) => (
              <Fragment key={row.label}>
                {row.subgroup && (
                  <tr>
                    <th scope="colgroup" colSpan={TIERS.length + 1} className="pt-6 pb-3 text-left">
                      <div className="max-md:sticky max-md:left-0 max-md:w-[calc(100vw-3rem)]">
                        <span className="block font-medium text-text-primary">
                          {row.subgroup.title}
                        </span>
                      </div>
                    </th>
                  </tr>
                )}
                {/* What doesn't work yet shows greyed out, its tag at full strength. */}
                <tr className="border-border-primary border-t">
                  <th
                    scope="row"
                    className="sticky left-0 z-[1] bg-background py-3 pr-4 text-left align-top font-normal text-text-secondary leading-6"
                  >
                    <span className={later(row) ? "opacity-55" : undefined}>{row.label}</span>
                    {row.status && (
                      <span className="ml-2 align-middle">
                        <StatusTag status={row.status} />
                      </span>
                    )}
                    {row.detail && (
                      <span
                        className={`block text-text-muted text-xs leading-5 ${later(row) ? "opacity-55" : ""}`}
                      >
                        {row.detail}
                      </span>
                    )}
                  </th>
                  {TIERS.map((plan) => (
                    <td
                      key={plan}
                      className={`px-3 py-3 align-top leading-6 ${later(row) ? "opacity-55" : ""}`}
                    >
                      <CellContent cell={row.cells[plan]} />
                    </td>
                  ))}
                </tr>
              </Fragment>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** A row that doesn't work at all yet, which shows greyed out. */
function later(row: Row): boolean {
  return row.status === "next" || row.status === "roadmap";
}

/** The status of what doesn't fully work yet, worded as Choose a version words it. */
export function StatusTag({ status }: { status: FeatureStatus }) {
  const tag = statusTag(status);
  if (!tag) return null;
  return (
    <span className="inline-flex shrink-0 whitespace-nowrap rounded-full bg-text-accent/10 px-2 py-0.5 font-semibold text-[0.6875rem] text-text-accent leading-4">
      {tag}
    </span>
  );
}

function CellContent({ cell }: { cell: Cell }) {
  switch (cell.kind) {
    case "yes":
      return (
        <svg
          role="img"
          aria-label="Included"
          viewBox="0 0 16 16"
          fill="none"
          className="mt-1 size-4 text-text-primary"
        >
          <path
            d="M3.5 8.5l3 3 6-7"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "no":
      return (
        <span className="text-text-muted">
          <span aria-hidden="true">—</span>
          <span className="sr-only">Not included</span>
        </span>
      );
    case "text":
      return (
        <>
          <span className="block text-text-primary">{cell.text}</span>
          {cell.notes?.map((note) => (
            <span key={note} className="block text-text-muted text-xs leading-5">
              {note}
            </span>
          ))}
        </>
      );
  }
}
