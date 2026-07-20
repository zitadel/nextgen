import { Link, type LinkProps } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Construction } from "lucide-react";
import type { ReactNode } from "react";

// `Button` is only needed by the parked CreateButtonStub below. Restore this
// import when real create actions are wired.
// import { Button } from "@zitadel/ui-react";

export interface PageTab {
  label: string;
  active?: boolean;
}

/**
 * Page hero to the Figma spec: title + optional sub-headline on the left, an
 * optional trailing action on the right, and an optional read-only tab row
 * underneath.
 */
export function PageHeader({
  title,
  description,
  action,
  tabs,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tabs?: PageTab[];
}) {
  return (
    <div className="mb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zl-text-primary">{title}</h1>
          {description && <p className="mt-1 text-sm text-zl-text-secondary">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {tabs && tabs.length > 0 && <TabNav tabs={tabs} />}
    </div>
  );
}

const TAB = "border-b-2 px-1 pb-2 pt-1 text-sm";
const TAB_ACTIVE = "border-zl-text-primary font-medium text-zl-text-primary";
const TAB_IDLE = "border-transparent text-zl-text-tertiary";

/**
 * Read-only label strip under the page hero. These are presentational only —
 * no sub-view navigation is wired yet — so they are deliberately NOT exposed as
 * an ARIA `tablist`/`tab` widget, which would announce an interactive tab
 * control to assistive tech that does nothing. When per-screen sub-navigation
 * lands, rebuild these as real links/buttons with the appropriate roles.
 */
function TabNav({ tabs }: { tabs: PageTab[] }) {
  return (
    <div className="mt-5 flex gap-6 border-b border-zl-border-subtle">
      {tabs.map((tab) => (
        <span key={tab.label} className={`${TAB} ${tab.active ? TAB_ACTIVE : TAB_IDLE}`}>
          {tab.label}
        </span>
      ))}
    </div>
  );
}

// Parked: a disabled "create" affordance with no backing form. Not data-driven,
// so it is commented out until per-resource create flows are wired.
// export function CreateButtonStub({ label }: { label: string }) {
//   return (
//     <Button hierarchy="primary" size="small" disabled leading={<span aria-hidden>+</span>}>
//       {label}
//     </Button>
//   );
// }

/** Underlined in-table link to a detail route. */
export function TableLink(props: LinkProps & { children: ReactNode }) {
  return <Link {...props} className="text-zl-text-primary underline underline-offset-2" />;
}

/**
 * "Coming soon" placeholder for screens whose backing API endpoint does not
 * exist yet (see the console-figma-api-buildability assessment). Honest empty
 * state rather than a fake list.
 */
export function EmptyState({
  title,
  description,
  icon: Icon = Construction,
  action,
}: {
  title: string;
  description: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-zl-l border border-dashed border-zl-border-subtle bg-zl-surface-raised px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-zl-surface-subtle text-zl-text-tertiary">
        <Icon size={22} aria-hidden />
      </span>
      <h2 className="text-base font-medium text-zl-text-primary">{title}</h2>
      <p className="max-w-md text-sm text-zl-text-secondary">{description}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// Shared table look. Kept as named constants so the (verbose) utility strings
// live in one place and Tailwind's scanner still sees full literals.
const TABLE_WRAP = "overflow-hidden rounded-zl-l border border-zl-border-subtle bg-zl-surface-raised";
const TABLE =
  "w-full border-collapse text-sm [&_tbody_tr:last-child_td]:border-0 [&_tbody_tr:last-child_th]:border-0";
const CELL = "border-b border-zl-border-subtle px-4 py-3 text-left";
const HEAD_CELL = `${CELL} text-xs font-normal uppercase tracking-wide text-zl-text-tertiary`;
const ROW_LABEL = `${CELL} font-normal text-zl-text-secondary`;

export interface Column<TRow> {
  header: string;
  cell: (row: TRow) => ReactNode;
}

/**
 * Minimal token-styled table with a built-in empty state. Loading and error
 * states are handled by the route's pending/error boundaries (Console
 * ADR 0001), so this component only renders the "rows vs empty" decision.
 */
export function DataTable<TRow>({
  columns,
  rows,
  getRowKey,
  emptyMessage = "Nothing here yet.",
}: {
  columns: Column<TRow>[];
  rows: TRow[];
  getRowKey: (row: TRow, index: number) => string;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-zl-text-secondary">{emptyMessage}</p>;
  }

  return (
    <div className={TABLE_WRAP}>
      <table className={TABLE}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.header} scope="col" className={HEAD_CELL}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={getRowKey(row, index)}>
              {columns.map((column) => (
                <td key={column.header} className={CELL}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Key/value detail table (label column + value column). */
export function KeyValueTable({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className={TABLE_WRAP}>
      <table className={TABLE}>
        <tbody>
          {rows.map(([key, value]) => (
            <tr key={key}>
              <th scope="row" className={ROW_LABEL}>
                {key}
              </th>
              <td className={CELL}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
