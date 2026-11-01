import type { PlanId } from "./catalog";
import { type Cell, type Group, PLANS } from "./compare";

const PLAN_NAMES: Record<PlanId, string> = { free: "Free", pro: "Pro", enterprise: "Enterprise" };

/**
 * The plans side by side, a group of rows per audience. From md up the plans'
 * names stick under the site's header (h-16) while the rows scroll; below md
 * the table scrolls sideways inside itself, never the page.
 */
export function CompareTable({
  groups,
  prices,
}: {
  groups: Group[];
  /** What each plan costs, under its name. */
  prices: Record<PlanId, string>;
}) {
  return (
    // Relative, so the cells' sr-only labels, which are absolute, scroll
    // with the table rather than widening the page.
    <div className="relative mt-8 max-md:overflow-x-auto">
      <table className="w-full min-w-[40rem] table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-[28%] md:w-[34%]" />
          {PLANS.map((plan) => (
            <col key={plan} className="w-[22%]" />
          ))}
        </colgroup>
        <thead>
          <tr>
            <td className="sticky left-0 z-10 bg-background md:top-16" />
            {PLANS.map((plan) => (
              <th
                key={plan}
                scope="col"
                className="border-border-primary border-b bg-background px-3 py-4 text-left font-normal md:sticky md:top-16 md:z-10"
              >
                <span className="block font-heading text-text-primary text-xl leading-tight">
                  {PLAN_NAMES[plan]}
                </span>
                <span className="mt-1 block text-text-muted text-xs leading-5">{prices[plan]}</span>
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.id}>
            <tr>
              <th scope="colgroup" colSpan={PLANS.length + 1} className="pt-12 pb-3 text-left">
                {/* Below md the title keeps to the screen while the plans scroll. */}
                <div className="max-md:sticky max-md:left-0 max-md:w-[calc(100vw-3rem)]">
                  <span className="block font-heading font-normal text-2xl text-text-primary leading-tight">
                    {group.title}
                  </span>
                  <span className="mt-1 block font-normal text-sm text-text-secondary leading-6">
                    {group.line}
                  </span>
                </div>
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr key={row.label} className="border-border-primary border-t">
                <th
                  scope="row"
                  className="sticky left-0 z-[1] bg-background py-3 pr-4 text-left align-top font-normal text-text-secondary leading-6"
                >
                  {row.label}
                </th>
                {PLANS.map((plan) => (
                  <td key={plan} className="px-3 py-3 align-top leading-6">
                    <CellContent cell={row.cells[plan]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
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
