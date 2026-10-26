import { Fragment, type ReactNode } from "react";

import { Separator } from "@/components/ui/separator";

export interface DetailRowItem {
  key: string;
  label: ReactNode;
  value: ReactNode;
}

// The label column: 148px on a phone, 218px from `sm`. Its right padding keeps
// a label that wraps off the value.
const LABEL =
  "w-37 shrink-0 pr-4 text-sm leading-5 font-medium break-words text-muted-foreground sm:w-54.5";
// The value starts at the column and wraps inside the row, however long.
const VALUE = "min-w-0 flex-1 text-left text-sm leading-5 text-foreground wrap-anywhere";

/**
 * A detail card's labelled values: the muted label in a fixed column, the value
 * beside it, a rule between rows. 4px block padding per row and 18px to the
 * rule (`gap-4.5`), as the release metadata card draws them.
 */
export function DetailRows({ rows }: { rows: DetailRowItem[] }) {
  return (
    <ul className="flex flex-col gap-4.5">
      {rows.map((row, index) => (
        <Fragment key={row.key}>
          {index > 0 && (
            <li role="none">
              <Separator />
            </li>
          )}
          <li className="flex items-start py-1">
            <span className={LABEL}>{row.label}</span>
            <span className={VALUE}>{row.value}</span>
          </li>
        </Fragment>
      ))}
    </ul>
  );
}
