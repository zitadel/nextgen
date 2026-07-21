import { Link, type LinkProps } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Construction } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Page hero: title + optional sub-headline on the left, optional trailing
 * action on the right. For filter tabs use shadcn `Tabs` (see Users).
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl tracking-tight text-foreground">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

/** Underlined in-table link to a detail route. */
export function TableLink({
  className,
  children,
  ...props
}: LinkProps & { children: ReactNode; className?: string }) {
  return (
    <Link {...props} className={cn("text-foreground underline underline-offset-2", className)}>
      {children}
    </Link>
  );
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
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon size={22} aria-hidden />
      </span>
      <h2 className="text-base font-medium text-foreground">{title}</h2>
      <div className="max-w-md text-sm text-muted-foreground">{description}</div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// Shared table look. Kept as named constants so the (verbose) utility strings
// live in one place and Tailwind's scanner still sees full literals.
const TABLE_WRAP = "overflow-hidden rounded-xl border border-border bg-card";
const TABLE =
  "w-full border-collapse text-sm [&_tbody_tr:last-child_td]:border-0 [&_tbody_tr:last-child_th]:border-0";
const CELL = "border-b border-border px-4 py-3 text-left";
const HEAD_CELL = `${CELL} text-xs font-normal uppercase tracking-wide text-muted-foreground`;
const ROW_LABEL = `${CELL} font-normal text-muted-foreground`;

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
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
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
